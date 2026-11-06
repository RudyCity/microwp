/**
 * NEVER DEPLOY: localhost-only SQL census facade using real WordPress/PHP-WASM.
 * No arbitrary PHP, SQL, WordPress paths or secrets are sent from test callers.
 */
import base,{MicroWPSite as BaseSite} from "../index-durable";
import {getPHP} from "../php/native";
import {LOCAL_SQL_CENSUS_PATH,LOCAL_SQL_CENSUS_PLUGIN} from "./wp-sql-census-local-plugin";
import {summarizeLocalSqlCensus} from "./wp-sql-census-policy";
import type {Env,ExecutionCtx} from "../types";

interface CensusEnv extends Env {
 SITE_DO:DurableObjectNamespace<BaseSite>;
 MICROWP_R36_SQL_CENSUS_LOCAL?:string;
}
const PATH="/__local/r36-sql-census";
function allowed(request:Request,env:CensusEnv):boolean{
 const u=new URL(request.url);
 return env.MICROWP_R36_SQL_CENSUS_LOCAL==="yes"&&
  u.hostname==="127.0.0.1"&&u.pathname===PATH&&
  request.method==="POST"&&u.search===""&&u.hash===""&&
  request.headers.get("content-length")==="0";
}
function noStore(data:unknown,status=200):Response{
 return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
export class MicroWPSite extends BaseSite{
 private pluginInstalled=false;
 override async fetch(request:Request):Promise<Response>{
  const env=this.env as CensusEnv;
  const url=new URL(request.url);
  if(url.pathname===PATH){
   if(!allowed(request,env))return new Response("Not Found",{status:404});
   if(!this.pluginInstalled)return noStore({error:"LOCAL_CENSUS_NOT_INITIALIZED"},409);
   try{
    // This local-only handler reads a fixed private MEMFS path; never runs PHP.
    const php=await getPHP(url.origin,env);
    if(!php.fileExists(LOCAL_SQL_CENSUS_PATH))
     return noStore({error:"NO_QUERY_SAMPLES"},409);
    const buf=php.readFileAsBuffer(LOCAL_SQL_CENSUS_PATH);
    if(buf.byteLength>96*1024)return noStore({error:"CENSUS_OVERSIZE"},503);
    const summary=summarizeLocalSqlCensus(
     new TextDecoder("utf-8",{fatal:true}).decode(buf)
    );
    return noStore(summary);
   }catch{return noStore({error:"LOCAL_CENSUS_UNAVAILABLE"},503);}
  }
  // The base object initializes the durable auth secret and D1 snapshot first.
  // Never call getPHP before super.fetch(), or restart login may be invalidated.
  const response=await super.fetch(request);
  if(!this.pluginInstalled&&env.MICROWP_R36_SQL_CENSUS_LOCAL==="yes"&&
     url.hostname==="127.0.0.1"&&response.status<500){
   try{
    const php=await getPHP(url.origin,env);
    if(!php.fileExists("/www/wp-content/mu-plugins"))
     php.mkdir("/www/wp-content/mu-plugins");
    php.writeFile("/www/wp-content/mu-plugins/microwp-r36-sql-census-local.php",
     LOCAL_SQL_CENSUS_PLUGIN);
    // This plugin exists only in the isolated local Workerd overlay.
    this.pluginInstalled=true;
   }catch{return noStore({error:"LOCAL_CENSUS_PLUGIN_FAILED"},503);}
  }
  return response;
 }
}
export default {
 async fetch(request:Request,env:CensusEnv,ctx:ExecutionCtx):Promise<Response>{
  const u=new URL(request.url);
  if(u.pathname===PATH){
   if(!allowed(request,env))return new Response("Not Found",{status:404});
   const id=env.SITE_DO.idFromName("microwp:single-site:v1");
   return env.SITE_DO.get(id).fetch(request);
  }
  return base.fetch(request,env,ctx);
 }
};
