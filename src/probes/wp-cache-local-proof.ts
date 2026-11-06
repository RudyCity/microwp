/** Local-only Durable Object proof for WordPress object cache PHP→Service Binding. */
import {DurableObject} from "cloudflare:workers";
import type {Env} from "../types";
import {runLocalWordPressObjectCacheProof} from "../php/worker-object-cache-local-proof";

interface ProofEnv extends Env {
 WP_CACHE_PROOF_DO:DurableObjectNamespace<WPObjectCacheProofDO>;
}
function allowed(request:Request):boolean{
 const url=new URL(request.url);
 return request.method==="POST"&&url.hostname==="127.0.0.1"&&
  url.pathname==="/__local/wordpress-cache-proof";
}
export class WPObjectCacheProofDO extends DurableObject<ProofEnv>{
 async fetch(request:Request):Promise<Response>{
  if(!allowed(request))return new Response("Not Found",{status:404});
  try{
   const proof=await runLocalWordPressObjectCacheProof(this.env);
   return Response.json(proof,{status:proof.ok?200:503,headers:{"Cache-Control":"no-store"}});
  }catch(error){
   console.error("local WordPress object cache proof failed",error instanceof Error?error.name:"unknown");
   return Response.json({ok:false,error:"PROOF_UNAVAILABLE"},{status:503});
  }
 }
}
export default {
 async fetch(request:Request,env:ProofEnv):Promise<Response>{
  if(!allowed(request))return new Response("Not Found",{status:404});
  const stub=env.WP_CACHE_PROOF_DO.get(env.WP_CACHE_PROOF_DO.idFromName("private-local-wordpress-cache-proof"));
  return stub.fetch(request);
 }
};
