/**
 * Post-commit, best-effort invalidation of strictly public WordPress content.
 * This cache is only a derived optimization: WordPress D1 is authoritative.
 * Cache keys MUST also be immutable and revision-derived, because an RPC can fail.
 */
import {WorkerRedisClient,type CacheBinding} from "../worker-cache/client";
import {OBJECT_CACHE_GROUP} from "./worker-object-cache-bridge";

export type InvalidationOutcome="skipped"|"flushed"|"unavailable";
const MUTATING=new Set(["POST","PUT","PATCH","DELETE"]);

export function shouldInvalidatePublicCache(
 method:string,enabled:unknown,binding:CacheBinding|undefined
):boolean {
 return enabled==="yes"&&!!binding&&MUTATING.has(method);
}
export async function invalidatePublicCacheAfterCommit(
 method:string,enabled:unknown,binding:CacheBinding|undefined,
 site="microwp_single_site"
):Promise<InvalidationOutcome>{
 if(!shouldInvalidatePublicCache(method,enabled,binding))return "skipped";
 try{
  await new WorkerRedisClient(binding!,site).flushGroup(OBJECT_CACHE_GROUP);
  return "flushed";
 }catch{return "unavailable"}
}
