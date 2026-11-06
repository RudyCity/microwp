import {CACHE_LIMITS,parseCacheCommand,type CacheResult,type CacheStats} from "./protocol";
interface Item{group:string;value:string;bytes:number;expiresAt:number}
/** Bounded, volatile LRU/TTL cache; DO eviction legitimately loses cache entries. */
export class BoundedCacheStore{
 private readonly entries=new Map<string,Item>();
 private bytes=0;private hits=0;private misses=0;private evictions=0;
 private readonly encoder=new TextEncoder();
 private token(group:string,key:string){return group+"\u0000"+key}
 private remove(key:string):boolean{
  const item=this.entries.get(key);if(!item)return false;
  this.entries.delete(key);this.bytes-=item.bytes;return true;
 }
 private peek(key:string,now:number,recordHit:boolean):Item|undefined{
  const item=this.entries.get(key);
  if(item&&item.expiresAt<=now){this.remove(key);if(recordHit)this.misses++;return undefined}
  if(!item){if(recordHit)this.misses++;return undefined}
  if(recordHit){this.hits++;this.entries.delete(key);this.entries.set(key,item)}
  return item;
 }
 private expireAll(now:number){
  for(const [key,item] of this.entries)if(item.expiresAt<=now)this.remove(key);
 }
 private insert(group:string,key:string,value:string,ttlSeconds:number,now:number,absoluteExpiry?:number):boolean{
  const token=this.token(group,key);
  const bytes=this.encoder.encode(value).byteLength+this.encoder.encode(token).byteLength;
  if(bytes>CACHE_LIMITS.maxBytes)return false;
  this.remove(token);this.expireAll(now);
  while(this.entries.size>=CACHE_LIMITS.maxKeys||this.bytes+bytes>CACHE_LIMITS.maxBytes){
   const oldest=this.entries.keys().next().value as string|undefined;
   if(oldest===undefined)return false;
   this.remove(oldest);this.evictions++;
  }
  this.entries.set(token,{group,value,bytes,expiresAt:absoluteExpiry??(now+ttlSeconds*1000)});this.bytes+=bytes;
  return true;
 }
 execute(input:unknown,now=Date.now()):CacheResult{
  const c=parseCacheCommand(input);
  if(!c||!Number.isFinite(now)||now<0)return {ok:false,error:"INVALID_COMMAND"};
  if(c.op==="stats"){
   this.expireAll(now);
   const stats:CacheStats={entries:this.entries.size,bytes:this.bytes,hits:this.hits,
    misses:this.misses,evictions:this.evictions};
   return {ok:true,stats};
  }
  if(c.op==="flushSite"){
   const deleted=this.entries.size;this.entries.clear();this.bytes=0;
   return {ok:true,deleted};
  }
  if(c.op==="flushGroup"){
   let deleted=0;
   for(const [key,item] of this.entries)if(item.group===c.group){this.remove(key);deleted++}
   return {ok:true,deleted};
  }
  const token=this.token(c.group,c.key);
  if(c.op==="get"){
   const item=this.peek(token,now,true);return {ok:true,value:item?.value??null};
  }
  if(c.op==="ttl"){
   const item=this.peek(token,now,false);
   return {ok:true,ttlSeconds:item?Math.ceil((item.expiresAt-now)/1000):-2};
  }
  if(c.op==="del")return {ok:true,deleted:this.peek(token,now,false)&&this.remove(token)?1:0};
  if(c.op==="expire"){
   const item=this.peek(token,now,false);
   if(!item)return {ok:true,stored:false};
   item.expiresAt=now+c.ttlSeconds*1000;return {ok:true,stored:true};
  }
  if(c.op==="set"||c.op==="add"){
   if(c.op==="add"&&this.peek(token,now,false))return {ok:true,stored:false};
   return {ok:true,stored:this.insert(c.group,c.key,c.value,c.ttlSeconds,now)};
  }
  // Atomic, bounded increment inside one DO invocation (no intervening await).
  const item=this.peek(token,now,false);
  if(item&&!/^(?:0|[1-9][0-9]{0,9})$/.test(item.value))
   return {ok:false,error:"NOT_INTEGER"};
  const old=item?Number(item.value):0;
  if(!Number.isSafeInteger(old)||old<0||old>2147483647-c.by)
   return {ok:false,error:"NOT_INTEGER"};
  const next=old+c.by;
  const ttl=item?Math.max(1,Math.ceil((item.expiresAt-now)/1000)):c.ttlSeconds;
  if(!this.insert(c.group,c.key,String(next),ttl,now,item?.expiresAt))return {ok:false,error:"CAPACITY"};
  return {ok:true,number:next};
 }
}
