/**
 * Private PHP-WASM -> JS -> Service Binding object-cache bridge.
 * Enabled only on trusted, explicitly opted-in WordPress runtime.
 * No HTTP endpoint, arbitrary PHP/SQL/Redis protocol, or tenant supplied site ID.
 */
import {WorkerRedisClient,type CacheBinding} from "../worker-cache/client";
import {CACHE_LIMITS,validKey} from "../worker-cache/protocol";

export const OBJECT_CACHE_MESSAGE_PREFIX="microwp:object-cache:v1:";
export const OBJECT_CACHE_GROUP="microwp_public";
export const OBJECT_CACHE_MAX_MESSAGE=90*1024;
export const OBJECT_CACHE_MAX_TTL=300;
const VERSIONED_PUBLIC_KEY=/^[a-z0-9][a-z0-9:_-]{0,160}:v[0-9a-f]{12,64}$/;

type Operation="get"|"set"|"add"|"del"|"flushGroup";
type Message={version:1;op:Operation;group:typeof OBJECT_CACHE_GROUP;key?:string;value?:string;ttlSeconds?:number};
type Reply={ok:boolean;found?:boolean;value?:string;stored?:boolean;deleted?:number};

function fail():string{return JSON.stringify({ok:false} satisfies Reply)}
function keysExact(record:Record<string,unknown>,allowed:string[]):boolean{
 const prototype=Object.getPrototypeOf(record);
 return (prototype===Object.prototype||prototype===null)&&Object.keys(record).every(k=>allowed.includes(k));
}
export function parseObjectCacheMessage(message:unknown):Message|null{
 if(typeof message!=="string"||!message.startsWith(OBJECT_CACHE_MESSAGE_PREFIX)||
  message.length>OBJECT_CACHE_MAX_MESSAGE)return null;
 let raw:unknown;
 try{raw=JSON.parse(message.slice(OBJECT_CACHE_MESSAGE_PREFIX.length))}catch{return null}
 if(raw===null||typeof raw!=="object"||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(r.version!==1||r.group!==OBJECT_CACHE_GROUP)return null;
 if(r.op==="flushGroup"){
  return keysExact(r,["version","group","op"])?{version:1,group:OBJECT_CACHE_GROUP,op:"flushGroup"}:null;
 }
 if(r.op!=="get"&&r.op!=="set"&&r.op!=="add"&&r.op!=="del")return null;
 if(!validKey(r.key)||!VERSIONED_PUBLIC_KEY.test(r.key))return null;
 if(r.op==="get"||r.op==="del"){
  if(!keysExact(r,["version","group","op","key"]))return null;
  return {version:1,group:OBJECT_CACHE_GROUP,op:r.op,key:r.key};
 }
 if(!keysExact(r,["version","group","op","key","value","ttlSeconds"])||
  typeof r.value!=="string"||r.value.length>65536||
  !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.value)||
  typeof r.ttlSeconds!=="number"||!Number.isSafeInteger(r.ttlSeconds)||
  r.ttlSeconds<1||r.ttlSeconds>OBJECT_CACHE_MAX_TTL)return null;
 return {version:1,group:OBJECT_CACHE_GROUP,op:r.op,key:r.key,value:r.value,ttlSeconds:r.ttlSeconds};
}
/** Always use a trusted env site, never a PHP-supplied or HTTP-supplied site. */
export async function handleObjectCacheMessage(message:unknown,binding:CacheBinding,site:string):Promise<string>{
 const command=parseObjectCacheMessage(message);
 if(!command)return fail();
 try{
  const cache=new WorkerRedisClient(binding,site);
  if(command.op==="get"){
   const value=await cache.get(command.group,command.key!);
   return JSON.stringify({ok:true,found:value!==null,...(value!==null?{value}:{})} satisfies Reply);
  }
  if(command.op==="set"||command.op==="add"){
   const stored=command.op==="set"
    ?await cache.set(command.group,command.key!,command.value!,command.ttlSeconds)
    :await cache.add(command.group,command.key!,command.value!,command.ttlSeconds);
   return JSON.stringify({ok:true,stored} satisfies Reply);
  }
  if(command.op==="del"){
   const deleted=await cache.del(command.group,command.key!);
   return JSON.stringify({ok:true,deleted} satisfies Reply);
  }
  const deleted=await cache.flushGroup(command.group);
  return JSON.stringify({ok:true,deleted} satisfies Reply);
 }catch{return fail()}
}
