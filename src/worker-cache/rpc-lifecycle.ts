/** Worker RPC values can carry hidden Symbol.dispose retainers.
 * Copy only known scalar fields before releasing the cross-isolate result.
 */
import type {CacheResult,CacheStats} from "./protocol";
const disposeSymbol=(Symbol as unknown as {dispose?:symbol}).dispose;

export function disposeCacheRPC(value:unknown):void{
 if(!disposeSymbol||value===null||
   (typeof value!=="object"&&typeof value!=="function"))return;
 const disposer=(value as {[key:symbol]:unknown})[disposeSymbol];
 if(typeof disposer==="function"){
  try{disposer.call(value)}catch{/* best effort; do not change cache read semantics */}
 }
}
export function detachCacheRPCResult(value:CacheResult):CacheResult{
 try{
  if(!value.ok)return {ok:false,error:value.error};
  const stats=value.stats;
  const copy:CacheStats|undefined=stats?{
   entries:stats.entries,bytes:stats.bytes,hits:stats.hits,
   misses:stats.misses,evictions:stats.evictions
  }:undefined;
  return {ok:true,
   ...(value.value!==undefined?{value:value.value}:{}),
   ...(value.stored!==undefined?{stored:value.stored}:{}),
   ...(value.deleted!==undefined?{deleted:value.deleted}:{}),
   ...(value.number!==undefined?{number:value.number}:{}),
   ...(value.ttlSeconds!==undefined?{ttlSeconds:value.ttlSeconds}:{}),
   ...(copy?{stats:copy}:{})
  };
 }finally{disposeCacheRPC(value)}
}
