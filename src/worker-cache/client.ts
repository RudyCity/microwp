/** Trusted per-site server-side client for the internal Service Binding.
 * Site identity is constructed from a server-owned value, NOT user HTTP input.
 */
import {CACHE_LIMITS,parseCacheCommand,validSite,type CacheCommand,type CacheResult} from "./protocol";
import {detachCacheRPCResult,disposeCacheRPC} from "./rpc-lifecycle";
export interface CacheBinding{execute(command:CacheCommand):Promise<CacheResult>}
export class WorkerRedisClient{
 constructor(private readonly binding:CacheBinding,private readonly site:string){
  if(!validSite(site))throw Error("Invalid trusted site identifier");
 }
 private async call(raw:Record<string,unknown>):Promise<CacheResult>{
  const command=parseCacheCommand({version:1,site:this.site,...raw});
  if(!command)throw Error("Invalid cache command");
  const pending=this.binding.execute(command);
  try{
   const response=await pending;
   return detachCacheRPCResult(response);
  }finally{disposeCacheRPC(pending)}
 }
 async get(group:string,key:string):Promise<string|null>{
  const result=await this.call({op:"get",group,key});
  if(!result.ok)throw Error("Cache unavailable");
  return result.value??null;
 }
 async set(group:string,key:string,value:string,ttlSeconds:number=CACHE_LIMITS.defaultTtlSeconds):Promise<boolean>{
  const result=await this.call({op:"set",group,key,value,ttlSeconds});
  if(!result.ok)throw Error("Cache unavailable");
  return result.stored===true;
 }
 async add(group:string,key:string,value:string,ttlSeconds:number=CACHE_LIMITS.defaultTtlSeconds):Promise<boolean>{
  const result=await this.call({op:"add",group,key,value,ttlSeconds});
  if(!result.ok)throw Error("Cache unavailable");
  return result.stored===true;
 }
 async del(group:string,key:string):Promise<number>{
  const result=await this.call({op:"del",group,key});
  if(!result.ok)throw Error("Cache unavailable");
  return result.deleted??0;
 }
 async incr(group:string,key:string,by=1,ttlSeconds:number=CACHE_LIMITS.defaultTtlSeconds):Promise<number>{
  const result=await this.call({op:"incr",group,key,by,ttlSeconds});
  if(!result.ok||result.number===undefined)throw Error("Cache unavailable or invalid integer");
  return result.number;
 }
 async expire(group:string,key:string,ttlSeconds:number):Promise<boolean>{
  const result=await this.call({op:"expire",group,key,ttlSeconds});
  if(!result.ok)throw Error("Cache unavailable");
  return result.stored===true;
 }
 async ttl(group:string,key:string):Promise<number>{
  const result=await this.call({op:"ttl",group,key});
  if(!result.ok)throw Error("Cache unavailable");
  return result.ttlSeconds??-2;
 }
 async flushGroup(group:string):Promise<number>{
  const result=await this.call({op:"flushGroup",group});
  if(!result.ok)throw Error("Cache unavailable");
  return result.deleted??0;
 }
 async flushSite():Promise<number>{
  const result=await this.call({op:"flushSite"});
  if(!result.ok)throw Error("Cache unavailable");
  return result.deleted??0;
 }
 async stats():Promise<{entries:number;bytes:number;hits:number;misses:number;evictions:number}>{
  const result=await this.call({op:"stats"});
  if(!result.ok||!result.stats)throw Error("Cache unavailable");
  return result.stats;
 }
}
