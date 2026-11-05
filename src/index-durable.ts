import { DurableObject } from "cloudflare:workers";
import type {Env,ExecutionCtx} from "./types";
import {handleRequest} from "./engine";
import {nativePhpHandler,readNativeDB,restoreNativeDB,restoreNativeMedia,finalizeNativeMedia} from "./php/native";
import {loadSQLiteSnapshot,saveSQLiteSnapshot,type SnapshotStore} from "./storage/sqlite-snapshot";
import {loadD1SQLite,saveD1SQLite} from "./storage/d1-sqlite";
import {blockedPath,isAssetPath,safePathname,withSafetyHeaders} from "./security";
import {getMedia} from "./media";
import {getR2WpContentStatic} from "./wp-content-static";
import {mayServePreview} from "./php/config";
import {isAuthorizedProbe,PROBE_PATH} from "./staging-probe";
import {runNativeStagingProbe} from "./php/native";
interface DurableEnv extends Env {SITE_DO:DurableObjectNamespace<MicroWPSite>}
function isLocal(host:string):boolean {return host==="localhost" || host==="127.0.0.1";}

export class MicroWPSite extends DurableObject<DurableEnv> {
  private firstLoad:Promise<void>|undefined;
  private queue:Promise<unknown>=Promise.resolve();
  private failed=false;
  private runtimeEnv:DurableEnv | undefined;
  private async initPersistence(origin:string):Promise<void> {
    if (!this.firstLoad) this.firstLoad=(async()=>{
      // WordPress auth cookies must survive isolate and process restarts.
      // The single-site DO owns the per-site auth secret; never return it in HTTP.
      let secret=this.env.WP_SECRET_KEY;
      if(secret && secret.length<64)throw new Error("Configured WordPress auth secret is too short");
      if(!secret){
        const stored=await this.ctx.storage.get<string>("microwp:private:auth-secret");
        if(stored && stored.length>=64) secret=stored;
        else {
          const random=new Uint8Array(64);crypto.getRandomValues(random);
          secret=Array.from(random,x=>x.toString(16).padStart(2,"0")).join("");
          await this.ctx.storage.put("microwp:private:auth-secret",secret);
        }
      }
      this.runtimeEnv={...this.env,WP_SECRET_KEY:secret,MICROWP_DEFER_MEDIA_DELETES:"yes"};
      const legacyStore=this.ctx.storage as unknown as SnapshotStore;
      const mode=this.env.MICROWP_STORAGE_DRIVER;
      if(mode==="d1"){
        if(!this.env.DB)throw new Error("D1 binding required in D1 storage mode");
        const d1Snapshot=await loadD1SQLite(this.env.DB);
        const legacySnapshot=await loadSQLiteSnapshot(legacyStore);
        // Never silently initialize a fresh DB when an old DO snapshot exists.
        if(legacySnapshot&&!d1Snapshot)throw new Error("Legacy DO snapshot requires explicit verified D1 migration");
        if(d1Snapshot)await restoreNativeDB(d1Snapshot,origin,this.runtimeEnv);
      }else{
        const snapshot=await loadSQLiteSnapshot(legacyStore);
        if(snapshot)await restoreNativeDB(snapshot,origin,this.runtimeEnv);
      }
      await restoreNativeMedia(origin,this.runtimeEnv);
    })();
    return this.firstLoad;
  }
  private once<T>(work:()=>Promise<T>):Promise<T> {
    const next=this.queue.then(work,work);
    this.queue=next.then(()=>undefined,()=>undefined);
    return next;
  }
  async fetch(req:Request):Promise<Response> {
    return this.once(async()=>{
      const url=new URL(req.url);
      if(!mayServePreview(url,this.env)||this.failed)return Response.json({error:"DB_STORAGE_UNAVAILABLE"},{status:503});
      try {
        await this.initPersistence(url.origin);
        const response=await handleRequest(req,this.runtimeEnv!,{waitUntil(p){void p.catch(()=>{})}},nativePhpHandler,"native-wasm-durable");
        const snapshot=await readNativeDB();
        if(snapshot){
          if(this.env.MICROWP_STORAGE_DRIVER==="d1"){
            if(!this.env.DB)throw new Error("D1 binding required in D1 storage mode");
            await saveD1SQLite(this.env.DB,snapshot);
          }else{
            await saveSQLiteSnapshot(this.ctx.storage as unknown as SnapshotStore,snapshot);
          }
        }
        // First publish the DB state, then make destructive R2 media changes.
        await finalizeNativeMedia(this.runtimeEnv!);
        return response;
      } catch(e) {
        this.failed=true;
        console.error("microWP persistence failed; refusing subsequent requests",e instanceof Error?e.message:"unknown");
        return Response.json({error:"DB_PERSISTENCE_FAILED"},{status:503,headers:{"Cache-Control":"no-store"}});
      }
    });
  }
}
export default {
  async fetch(request:Request,env:DurableEnv,ctx:ExecutionCtx):Promise<Response> {
    const url=new URL(request.url);
    const path=safePathname(url);
    if(!path||blockedPath(path))return withSafetyHeaders(new Response("Not Found",{status:404}));
    if(path==="/__microwp/health")return withSafetyHeaders(Response.json({name:"microWP",php:"native-wasm",storage:env.MICROWP_STORAGE_DRIVER==="d1"?"d1-sqlite-bridge":"durable-object",publicReady:false},{headers:{"Cache-Control":"no-store"}}));
    if(path===PROBE_PATH){
      if(!await isAuthorizedProbe(request,env))return withSafetyHeaders(new Response("Not Found",{status:404,headers:{"Cache-Control":"no-store"}}));
      // Only a fixed read-only PHP/WebAssembly canary is accepted; never forward user paths or PHP code.
      const scope=request.headers.get("x-microwp-probe-scope")??"runtime";
      if(scope!=="runtime"&&scope!=="wordpress"&&scope!=="storage"&&scope!=="storage-write-test")return withSafetyHeaders(new Response("Bad Request",{status:400,headers:{"Cache-Control":"no-store"}}));
      try {
        if(scope==="storage-write-test"){
          if(!env.DB||env.MICROWP_STORAGE_DRIVER!=="d1")throw new Error("D1 canary requires isolated staging DB binding");
          const canarySite="microwp:private-canary:v1";
          const known=new Uint8Array([83,81,76,105,116,101,115,116,42,0,7,19,255,83]);
          try{
            await saveD1SQLite(env.DB,known,canarySite);
            const loaded=await loadD1SQLite(env.DB,canarySite);
            const matched=!!loaded&&loaded.length===known.length&&loaded.every((value,i)=>value===known[i]);
            return withSafetyHeaders(Response.json({ok:matched,backend:"d1-batch-blob",bytes:known.length,verified:matched},{status:matched?200:503,headers:{"Cache-Control":"no-store"}}));
          }finally{
            await env.DB.batch([
              env.DB.prepare("DELETE FROM microwp_db_chunks WHERE site_id=?").bind(canarySite),
              env.DB.prepare("DELETE FROM microwp_db_snapshots WHERE site_id=?").bind(canarySite)
            ]);
          }
        }
        if(scope==="storage"){
          if(!env.DB||!env.MEDIA||env.MICROWP_STORAGE_DRIVER!=="d1")throw new Error("D1/R2 staging bindings incomplete");
          const tables=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('microwp_db_snapshots','microwp_db_chunks') ORDER BY name").all<{name:string}>();
          const media=await env.MEDIA.list?.({prefix:"wp-content/uploads/",limit:1});
          const valid=!!tables.success&&tables.results.map(t=>t.name).join(",")==="microwp_db_chunks,microwp_db_snapshots"&&!!media;
          return withSafetyHeaders(Response.json({ok:valid,backend:"d1-sqlite-bridge",r2Prefix:"wp-content/uploads/",d1Tables:tables.results.length,r2Available:!!media,publicReady:false},{status:valid?200:503,headers:{"Cache-Control":"no-store"}}));
        }
        return withSafetyHeaders(Response.json(await runNativeStagingProbe(env,scope),{headers:{"Cache-Control":"no-store"}}));
      } catch (error) {
        console.error("Private staging PHP probe failed",error instanceof Error?error.message:"unknown");
        return withSafetyHeaders(Response.json({error:"PRIVATE_PROBE_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}}));
      }
    }
    if(path.startsWith("/__microwp/"))return withSafetyHeaders(new Response("Not Found",{status:404}));
    // Public staging must never expose media or static site files while alpha is gated.
    if(!isLocal(url.hostname))return Response.json({error:"PREVIEW_ONLY_NO_PRODUCTION_DEPLOY"},{status:503,headers:{"Cache-Control":"no-store"}});
    if(path.startsWith("/wp-content/uploads/"))return withSafetyHeaders(await getMedia(request,env,path));
    if(["GET","HEAD"].includes(request.method)&&isAssetPath(path)){
      const r2Asset=await getR2WpContentStatic(request,env,path);
      if(r2Asset)return withSafetyHeaders(r2Asset);
    }
    if(["GET","HEAD"].includes(request.method)&&isAssetPath(path)&&env.ASSETS){
      const asset=await env.ASSETS.fetch(request);
      if(asset.status!==404)return withSafetyHeaders(asset);
    }
    const id=env.SITE_DO.idFromName("microwp:single-site:v1");
    return env.SITE_DO.get(id).fetch(request);
  }
};
