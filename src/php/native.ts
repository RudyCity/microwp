import { PHP, loadPHPRuntime } from "@php-wasm/universal";
import * as loader from "../../experiments/generated/php-loader.js";
import phpWasmModule from "../../node_modules/@php-wasm/web-8-4/asyncify/8_4_27/php_8_4.wasm";
import wordpressArchive from "../../generated/wordpress-php.bin";
import { mountWordPress,type MountStats } from "./zip-files";
import { wordpressConfig, mayServePreview } from "./config";
import {flushUploads,hydrateUploads} from "./uploads";
import type { Env, PhpHandler } from "../types";

const MAX_BODY_BYTES = 1024 * 1024;
let init: Promise<PHP> | undefined;
let serial: Promise<unknown> = Promise.resolve();
let stats: MountStats | null = null;
const uploaded=new Map<string,string>();
let storageUnsafe=false;
export function nativeStats() {return {runtime:"php-8.4.27-wasm",mounted:stats!==null,files:stats?.files??0,unpackedBytes:stats?.bytes??0,mountMs:stats?.elapsedMs??0,loadedFiles:stats?.loadedFiles??0,loadedBytes:stats?.loadedBytes??0};}

async function getPHP(origin:string, env:Env): Promise<PHP> {
  if (!init) init = (async () => {
    const runtime = await loadPHPRuntime(loader as unknown as Parameters<typeof loadPHPRuntime>[0],{
      instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module)=>void) {
        const instance = new WebAssembly.Instance(phpWasmModule,imports);
        receive(instance,phpWasmModule);
        return instance.exports;
      }
    });
    const php = new PHP(runtime);
    stats=await mountWordPress(php,new Uint8Array(wordpressArchive));
    php.mkdir("/private");
    php.writeFile("/www/wp-config.php",wordpressConfig(origin,env));
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
  const declared=Number(request.headers.get("content-length")??0);
  if (declared>MAX_BODY_BYTES) return new Response("Request body too large",{status:413});
  let body:Uint8Array=new Uint8Array();
  if (request.method!=="GET" && request.method!=="HEAD") {
    body=new Uint8Array(await request.arrayBuffer());
    if (body.byteLength>MAX_BODY_BYTES) return new Response("Request body too large",{status:413});
  }
  return oneAtATime(async()=>{
    try {
      const php=await getPHP(url.origin,env);
      // WordPress pretty URLs are dispatched to index.php. Keep /wp-admin, REST and login.
      let scriptPath="/www/index.php";
      if (url.pathname.toLowerCase().endsWith(".php")) scriptPath="/www"+url.pathname;
      if (url.pathname.startsWith("/wp-admin/") && url.pathname.endsWith("/")) scriptPath="/www/wp-admin/index.php";
      if(!php.fileExists(scriptPath)) return new Response("Not Found",{status:404});
      const output=await php.run({
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
      try { await flushUploads(php,env,uploaded); }
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
