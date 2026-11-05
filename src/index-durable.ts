import { DurableObject } from "cloudflare:workers";
import type {Env,ExecutionCtx} from "./types";
import {handleRequest} from "./engine";
import {nativePhpHandler,nativeStats,readNativeDB,restoreNativeDB} from "./php/native";
import {loadSQLiteSnapshot,saveSQLiteSnapshot,type SnapshotStore} from "./storage/sqlite-snapshot";
import {blockedPath,isAssetPath,safePathname,withSafetyHeaders} from "./security";
import {getMedia} from "./media";
import {mayServePreview} from "./php/config";
interface DurableEnv extends Env {SITE_DO:DurableObjectNamespace<MicroWPSite>}
function isLocal(host:string):boolean {return host==="localhost" || host==="127.0.0.1";}

export class MicroWPSite extends DurableObject<DurableEnv> {
  private firstLoad:Promise<void>|undefined;
  private queue:Promise<unknown>=Promise.resolve();
  private failed=false;
  private async initPersistence(origin:string):Promise<void> {
    if (!this.firstLoad) this.firstLoad=(async()=>{
      const snapshot=await loadSQLiteSnapshot(this.ctx.storage as unknown as SnapshotStore);
      if(snapshot)await restoreNativeDB(snapshot,origin,this.env);
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
        const response=await handleRequest(req,this.env,{waitUntil(p){void p.catch(()=>{})}},nativePhpHandler,"native-wasm-durable");
        const snapshot=await readNativeDB();
        if(snapshot)await saveSQLiteSnapshot(this.ctx.storage as unknown as SnapshotStore,snapshot);
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
    if(path==="/__microwp/health")return withSafetyHeaders(Response.json({name:"microWP",php:"native-wasm",storage:"durable-object",publicReady:false},{headers:{"Cache-Control":"no-store"}}));
    if(path.startsWith("/__microwp/"))return withSafetyHeaders(new Response("Not Found",{status:404}));
    if(path.startsWith("/wp-content/uploads/"))return withSafetyHeaders(await getMedia(request,env,path));
    if(["GET","HEAD"].includes(request.method)&&isAssetPath(path)&&env.ASSETS){
      const asset=await env.ASSETS.fetch(request);
      if(asset.status!==404)return withSafetyHeaders(asset);
    }
    // No durable site open to the public before media and production security gates pass.
    if(!isLocal(url.hostname))return Response.json({error:"PREVIEW_ONLY_NO_PRODUCTION_DEPLOY"},{status:503,headers:{"Cache-Control":"no-store"}});
    const id=env.SITE_DO.idFromName("microwp:single-site:v1");
    return env.SITE_DO.get(id).fetch(request);
  }
};
