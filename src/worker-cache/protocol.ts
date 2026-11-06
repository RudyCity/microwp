/** Small internal Redis-like RPC. NOT RESP/TCP or full Redis compatibility. */
export const CACHE_LIMITS=Object.freeze({
 maxKeys:1024,maxBytes:8*1024*1024,maxValueBytes:64*1024,maxKeyBytes:240,
 maxTtlSeconds:86400,defaultTtlSeconds:300,maxIncrement:1000
});
interface Base{version:1;site:string}
interface WithKey extends Base {group:string;key:string}
export type CacheCommand=
 |(WithKey & {op:"get"})
 |(WithKey & {op:"del"})
 |(WithKey & {op:"ttl"})
 |(WithKey & {op:"set";value:string;ttlSeconds:number})
 |(WithKey & {op:"add";value:string;ttlSeconds:number})
 |(WithKey & {op:"incr";by:number;ttlSeconds:number})
 |(WithKey & {op:"expire";ttlSeconds:number})
 |(Base & {op:"flushGroup";group:string})
 |(Base & {op:"flushSite"})
 |(Base & {op:"stats"});
export interface CacheStats{entries:number;bytes:number;hits:number;misses:number;evictions:number}
export type CacheResult=
 |{ok:true;value?:string|null;stored?:boolean;deleted?:number;number?:number;ttlSeconds?:number;stats?:CacheStats}
 |{ok:false;error:"INVALID_COMMAND"|"CAPACITY"|"NOT_INTEGER"|"UNAVAILABLE"};
const SITE=/^[a-z][a-z0-9_-]{0,63}$/;
const GROUP=/^[a-z][a-z0-9_-]{0,31}$/;
const PRIVATE_GROUPS=/^(?:users?|user_meta|auth|sessions?|cookies?|tokens?|passwords?|nonces?)$/;
const encoder=new TextEncoder();
export function validSite(value:unknown):value is string {
 return typeof value==="string"&&SITE.test(value);
}
export function validGroup(value:unknown):value is string {
 return typeof value==="string"&&GROUP.test(value)&&!PRIVATE_GROUPS.test(value);
}
export function validKey(value:unknown):value is string {
 return typeof value==="string"&&value.length>0&&value.normalize("NFC")===value&&
 encoder.encode(value).byteLength<=CACHE_LIMITS.maxKeyBytes&&!/[\u0000-\u001f\u007f]/.test(value);
}
function int(value:unknown,max:number):value is number{
 return typeof value==="number"&&Number.isSafeInteger(value)&&value>=1&&value<=max;
}
function fields(o:Record<string,unknown>,allowed:string[]):boolean{
 const proto=Object.getPrototypeOf(o);
 return (proto===Object.prototype||proto===null)&&Object.keys(o).every(k=>allowed.includes(k));
}
export function parseCacheCommand(raw:unknown):CacheCommand|null{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
 const o=raw as Record<string,unknown>;
 if(o.version!==1||!validSite(o.site)||typeof o.op!=="string")return null;
 if(o.op==="stats"||o.op==="flushSite"){
  if(!fields(o,["version","site","op"]))return null;
  return {version:1,site:o.site,op:o.op};
 }
 if(!validGroup(o.group))return null;
 if(o.op==="flushGroup"){
  if(!fields(o,["version","site","op","group"]))return null;
  return {version:1,site:o.site,op:o.op,group:o.group};
 }
 if(!validKey(o.key))return null;
 if(o.op==="get"||o.op==="del"||o.op==="ttl"){
  if(!fields(o,["version","site","op","group","key"]))return null;
  return {version:1,site:o.site,op:o.op,group:o.group,key:o.key};
 }
 if(o.op==="set"||o.op==="add"){
  if(!fields(o,["version","site","op","group","key","value","ttlSeconds"])||
   typeof o.value!=="string"||encoder.encode(o.value).byteLength>CACHE_LIMITS.maxValueBytes||
   !int(o.ttlSeconds,CACHE_LIMITS.maxTtlSeconds))return null;
  return {version:1,site:o.site,op:o.op,group:o.group,key:o.key,value:o.value,ttlSeconds:o.ttlSeconds};
 }
 if(o.op==="incr"){
  if(!fields(o,["version","site","op","group","key","by","ttlSeconds"])||
   !int(o.by,CACHE_LIMITS.maxIncrement)||!int(o.ttlSeconds,CACHE_LIMITS.maxTtlSeconds))return null;
  return {version:1,site:o.site,op:o.op,group:o.group,key:o.key,by:o.by,ttlSeconds:o.ttlSeconds};
 }
 if(o.op==="expire"){
  if(!fields(o,["version","site","op","group","key","ttlSeconds"])||
   !int(o.ttlSeconds,CACHE_LIMITS.maxTtlSeconds))return null;
  return {version:1,site:o.site,op:o.op,group:o.group,key:o.key,ttlSeconds:o.ttlSeconds};
 }
 return null;
}
