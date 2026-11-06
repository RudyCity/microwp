import { PHP, loadPHPRuntime } from "@php-wasm/universal";
import * as loader from "../../experiments/generated/php-loader.js";
import phpWasmModule from "../../node_modules/@php-wasm/web-8-4/asyncify/8_4_27/php_8_4.wasm";
import wordpressArchive from "../../generated/wordpress-php.bin";
import { mountWordPress,type MountStats } from "./zip-files";
import { wordpressConfig, mayServePreview } from "./config";
import {flushUploads,hydrateUploads,finalizeUploadDeletes} from "./uploads";
import {D1_BRIDGE_READINESS_MESSAGE,handleD1BridgeReadinessMessage} from "./d1-message-bridge";
import {readBoundedRequestBody} from "./bounded-body";
import {buildWorkerObjectCacheDropin} from "./worker-object-cache-dropin";
import {handleObjectCacheMessage,OBJECT_CACHE_MESSAGE_PREFIX} from "./worker-object-cache-bridge";
import type { Env, PhpHandler } from "../types";

let init: Promise<PHP> | undefined;
let serial: Promise<unknown> = Promise.resolve();
let stats: MountStats | null = null;
const uploaded=new Map<string,string>();
const pendingMediaDeletes=new Set<string>();
let storageUnsafe=false;
export function nativeStats() {return {runtime:"php-8.4.27-wasm",mounted:stats!==null,files:stats?.files??0,unpackedBytes:stats?.bytes??0,mountMs:stats?.elapsedMs??0,loadedFiles:stats?.loadedFiles??0,loadedBytes:stats?.loadedBytes??0};}

export async function getPHP(origin:string, env:Env): Promise<PHP> {
  if (!init) init = (async () => {
    const staging=env.MICROWP_STAGING_MODE==="isolated-probe-only";
    const start=performance.now();
    if(staging)console.info("microWP isolated canary: WASM_BEGIN");
    const runtime = await loadPHPRuntime(loader as unknown as Parameters<typeof loadPHPRuntime>[0],{
      instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module)=>void) {
        const instance = new WebAssembly.Instance(phpWasmModule,imports);
        receive(instance,phpWasmModule);
        return instance.exports;
      }
    });
    if(staging)console.info("microWP isolated canary: WASM_READY_MS",Math.round(performance.now()-start));
    const php = new PHP(runtime);
    stats=await mountWordPress(php,new Uint8Array(wordpressArchive));
    if(staging)console.info("microWP isolated canary: ZIP_READY_MS",Math.round(performance.now()-start));
    php.mkdir("/private");
    php.writeFile("/www/wp-config.php",wordpressConfig(origin,env));
    if(env.MICROWP_WORKER_CACHE_ENABLED==="yes"&&env.REDIS_WORKER){
      // Explicit private opt-in only. Core WordPress cache API stays pinned and
      // all existing non-opted groups retain request-local WP cache semantics.
      const coreCache=php.readFileAsText("/www/wp-includes/cache.php");
      php.writeFile("/www/wp-content/object-cache.php",buildWorkerObjectCacheDropin(coreCache));
    }
    if(staging)console.info("microWP isolated canary: CONFIG_READY_MS",Math.round(performance.now()-start));
    return php;
  })().catch((e)=>{init=undefined;stats=null;throw e});
  return init;
}
function oneAtATime<T>(work:()=>Promise<T>):Promise<T> {
  const result=serial.then(work,work);
  serial=result.then(()=>undefined,()=>undefined);
  return result;
}
function guardedHeaders(request:Request):Record<string,string> {
  const out:Record<string,string>={};
  for (const key of ["Host","Accept","Accept-Language","Content-Type","Content-Disposition","Cookie","User-Agent","X-Requested-With","X-WP-Nonce","X-HTTP-Method-Override","Origin","Referer"]) {
    const value=request.headers.get(key);
    if(value) out[key]=value;
  }
  return out;
}
export const nativePhpHandler:PhpHandler = async(request, env) => {
  const url=new URL(request.url);
  if (storageUnsafe) return Response.json({error:"MEDIA_WRITE_FAILURE"},{status:503});
  if (!mayServePreview(url,env)) return Response.json({error:"PREVIEW_ONLY_NO_DURABLE_DB"},{status:503,headers:{"Cache-Control":"no-store"}});
  if (!["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].includes(request.method)) return new Response("Method Not Allowed",{status:405,headers:{Allow:"GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"}});
  let body:Uint8Array;
  try {
    const bounded=await readBoundedRequestBody(request);
    if(bounded===null)return new Response("Request body too large",{status:413});
    body=bounded;
  } catch {
    return new Response("Invalid request body",{status:400});
  }
  return oneAtATime(async()=>{
    try {
      const php=await getPHP(url.origin,env);
      // WordPress pretty URLs are dispatched to index.php. Keep /wp-admin, REST and login.
      let scriptPath="/www/index.php";
      if (url.pathname.toLowerCase().endsWith(".php")) scriptPath="/www"+url.pathname;
      if (url.pathname.startsWith("/wp-admin/") && url.pathname.endsWith("/")) scriptPath="/www/wp-admin/index.php";
      if(!php.fileExists(scriptPath)) return new Response("Not Found",{status:404});
      const useObjectCache=env.MICROWP_WORKER_CACHE_ENABLED==="yes"&&!!env.REDIS_WORKER;
      const stopCache=useObjectCache ? php.onMessage(async message=>{
        if(!message.startsWith(OBJECT_CACHE_MESSAGE_PREFIX))return "";
        return handleObjectCacheMessage(message,env.REDIS_WORKER!,"microwp_single_site");
      }):undefined;
      let output:Awaited<ReturnType<PHP["run"]>>;
      try {
      output=await php.run({
        scriptPath,
        relativeUri:url.pathname+url.search,
        protocol:url.protocol.slice(0,-1),
        method: request.method as "GET" | "POST" | "HEAD" | "OPTIONS" | "PATCH" | "PUT" | "DELETE",
        headers:guardedHeaders(request),
        body,
        $_SERVER:{
          HTTPS:url.protocol==="https:"?"on":"off",
          HTTP_HOST:url.host,
          SERVER_NAME:url.hostname,
          SERVER_PORT:url.port||(url.protocol==="https:"?"443":"80"),
          DOCUMENT_ROOT:"/www",
          SCRIPT_FILENAME:scriptPath,
          SCRIPT_NAME:scriptPath.slice(4),
        }
      });
      } finally { await stopCache?.(); }
      try { await flushUploads(php,env,uploaded,env.MICROWP_DEFER_MEDIA_DELETES==="yes"?pendingMediaDeletes:undefined); }
      catch(err) { storageUnsafe=true; throw err; }
      const headers=new Headers();
      for (const [key,values] of Object.entries(output.headers)) {
        if (["connection","transfer-encoding","content-length"].includes(key.toLowerCase()))continue;
        for (const v of values) headers.append(key,v);
      }
      if(!headers.has("Content-Type")) headers.set("Content-Type","text/html; charset=utf-8");
      headers.set("Cache-Control","no-store");
      const status=output.httpStatusCode >=200 && output.httpStatusCode<=599?output.httpStatusCode:500;
      if (output.exitCode !== 0) return Response.json({error:"PHP_RUNTIME_ERROR",message:"PHP request failed"},{status:502,headers:{"Cache-Control":"no-store"}});
      if (output.bytes.byteLength>2*1024*1024) return new Response("PHP output too large",{status:502});
      const resultBuffer=new ArrayBuffer(output.bytes.byteLength);
      new Uint8Array(resultBuffer).set(output.bytes);
      return new Response(request.method==="HEAD"?null:resultBuffer,{status,headers});
    } catch(e) {
      console.error("microWP native PHP runtime error",e instanceof Error?e.message:"unknown");
      return Response.json({error:"PHP_RUNTIME_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
    }
  });
};

/** Invoked by single-site Durable Object only, before serving any PHP request. */
export async function restoreNativeDB(bytes: Uint8Array, origin:string,env:Env):Promise<void>{
  const php=await getPHP(origin,env);
  php.writeFile("/private/microwp.sqlite",bytes);
}
/** Copies SQLite bytes after each PHP request has completed and connections closed. */
export async function readNativeDB():Promise<Uint8Array|null>{
  if(storageUnsafe) throw new Error("Media write-through failed; refuse DB snapshot");
  if(!init)return null;
  const php=await init;
  if(!php.fileExists("/private/microwp.sqlite"))return null;
  return new Uint8Array(php.readFileAsBuffer("/private/microwp.sqlite"));
}

/** DO cold-start hook, after DB restoration, before WordPress can use media files. */
export async function restoreNativeMedia(origin:string,env:Env):Promise<number>{
 const php=await getPHP(origin,env);
 return hydrateUploads(php,env,uploaded);
}

/** Read-only canary for private staging only. Never accepts script text or paths from requests. */
export async function runNativeStagingProbe(env:Env,scope:"runtime"|"wordpress"="runtime"):Promise<{
  ok:boolean;scope:"runtime"|"wordpress";phpVersion:string;sqlite:boolean;phpExitCode:number;installerStatus:number|null;
  installerForm:boolean;runtimeInitMs:number;requestMs:number;stats:ReturnType<typeof nativeStats>
}>{
  return oneAtATime(async()=>{
    const start=performance.now();
    const php=await getPHP("https://microwp-private-probe.invalid",env);
    const afterInit=performance.now();
    if(env.MICROWP_STAGING_MODE==="isolated-probe-only")console.info("microWP isolated canary: PHP_RUN_BEGIN");
    const check=await php.run({code:"<?php echo PHP_VERSION . '|' . (extension_loaded('pdo_sqlite') ? 'sqlite' : 'missing');"});
    if(env.MICROWP_STAGING_MODE==="isolated-probe-only")console.info("microWP isolated canary: PHP_RUN_READY");
    const version=new TextDecoder().decode(check.bytes).trim().split("|");
    // One fixed, GET-only WordPress installer request with its own ephemeral DB.
    if(scope==="wordpress"&&env.MICROWP_STAGING_MODE==="isolated-probe-only")console.info("microWP isolated canary: WORDPRESS_INSTALLER_BEGIN");
    const installer=scope==="wordpress"?await php.run({
      scriptPath:"/www/wp-admin/install.php",
      relativeUri:"/wp-admin/install.php?step=1",
      method:"GET",protocol:"https",
      $_SERVER:{HTTPS:"on",HTTP_HOST:"microwp-private-probe.invalid",SERVER_NAME:"microwp-private-probe.invalid",SERVER_PORT:"443",
        DOCUMENT_ROOT:"/www",SCRIPT_FILENAME:"/www/wp-admin/install.php",SCRIPT_NAME:"/wp-admin/install.php"}
    }):null;
    if(installer&&env.MICROWP_STAGING_MODE==="isolated-probe-only")console.info("microWP isolated canary: WORDPRESS_INSTALLER_READY");
    const body=installer?new TextDecoder().decode(installer.bytes):"";
    const phpOkay=check.exitCode===0&&version[0]==="8.4.27"&&version[1]==="sqlite";
    const ok=phpOkay&&(scope==="runtime"||(installer?.exitCode===0&&installer.httpStatusCode===200&&body.includes("weblog_title")));
    return {ok,scope,phpVersion:version[0]??"unknown",sqlite:version[1]==="sqlite",phpExitCode:check.exitCode,installerStatus:installer?.httpStatusCode??null,
      installerForm:body.includes("weblog_title"),runtimeInitMs:Math.round(afterInit-start),requestMs:Math.round(performance.now()-start),stats:nativeStats()};
  });
}

/** After the DO has persisted its database snapshot, delete no-longer-referenced media. */
export async function finalizeNativeMedia(env:Env):Promise<number>{
 if(storageUnsafe)throw new Error("Media filesystem already unsafe");
 try{return await finalizeUploadDeletes(env,uploaded,pendingMediaDeletes)}
 catch(error){storageUnsafe=true;throw error}
}

/** Paths queued during PHP execution; the DO atomically journals them in D1 with its DB image. */
export function pendingNativeMediaDeletePaths():string[]{
 return [...pendingMediaDeletes];
}
/** D1 journal has finished deleting R2 files. Update the in-memory image without extra R2 calls. */
export function acknowledgeNativeMediaDeletes():void{
 for(const path of pendingMediaDeletes)uploaded.delete(path);
 pendingMediaDeletes.clear();
}

/**
 * Private, read-only capability test for PHP->JS async messages reaching a D1 query.
 * Never accepts PHP code, a SQL statement, a table name, or user arguments.
 * A real WordPress wpdb adapter requires an independent compatibility/security review.
 */
export async function runNativeD1SqlBridgeProbe(env:Env):Promise<{ok:boolean;bridge:"php-wasm-to-worker-d1";d1FromPhp:boolean;phpExitCode:number}>{
 if(env.MICROWP_STAGING_MODE!=="isolated-probe-only"||!env.DB)throw new Error("Private staging D1 binding required");
 return oneAtATime(async()=>{
  const php=await getPHP("https://microwp-private-probe.invalid",env);
  const stop=php.onMessage(message=>handleD1BridgeReadinessMessage(message,env.DB!));
  try{
   const response=await php.run({code:`<?php echo post_message_to_js('${D1_BRIDGE_READINESS_MESSAGE}');`});
   let result:{ready?:boolean}={};
   try {result=JSON.parse(new TextDecoder().decode(response.bytes)) as {ready:boolean}}catch{}
   const ok=response.exitCode===0&&result.ready===true;
   return {ok,bridge:"php-wasm-to-worker-d1",d1FromPhp:ok,phpExitCode:response.exitCode};
  }finally{await stop()}
 });
}
