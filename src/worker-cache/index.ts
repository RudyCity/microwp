/** Dedicated Redis-like cache on Cloudflare Free: Service Binding RPC only.
 * No TCP/RESP Redis protocol, external Redis, publicly accessible HTTP,
 * D1 or R2. Each trusted site is mapped to its own in-memory Durable Object.
 */
import {DurableObject,WorkerEntrypoint} from "cloudflare:workers";
import {BoundedCacheStore} from "./store";
import {parseCacheCommand,type CacheResult} from "./protocol";
interface CacheEnv{CACHE_DO:DurableObjectNamespace<MicroWPWorkerCacheDO>}
const INVALID:CacheResult={ok:false,error:"INVALID_COMMAND"};
export class MicroWPWorkerCacheDO extends DurableObject<CacheEnv>{
 private readonly cache=new BoundedCacheStore();
 async execute(raw:unknown):Promise<CacheResult>{
  const command=parseCacheCommand(raw);
  if(!command)return INVALID;
  return this.cache.execute(command);
 }
}
export default class MicroWPWorkerCache extends WorkerEntrypoint<CacheEnv>{
 async fetch():Promise<Response>{
  return new Response("Not Found",{status:404,headers:{"Cache-Control":"no-store"}});
 }
 async execute(raw:unknown):Promise<CacheResult>{
  const command=parseCacheCommand(raw);
  if(!command)return INVALID;
  try{
   const id=this.env.CACHE_DO.idFromName("microwp-cache:"+command.site);
   return await this.env.CACHE_DO.get(id).execute(command);
  }catch{
   return {ok:false,error:"UNAVAILABLE"};
  }
 }
}
