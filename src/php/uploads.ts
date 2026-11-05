import type {PHP} from "@php-wasm/universal";
import type {Env} from "../types";
import {mediaKey,MAX_MEDIA_BYTES,putMedia,validMediaSignature} from "../media";
import {digest} from "../storage/sqlite-snapshot";

const ROOT="/www/wp-content/uploads";
const MAX_FILES=32;
const MAX_HYDRATION_BYTES=16*1024*1024;
type Filesystem=Pick<PHP,"isDir"|"isFile"|"listFiles"|"readFileAsBuffer">;
type HydrationFilesystem=Pick<PHP,"mkdir"|"writeFile">;

/** Fails closed if R2 has more media than this isolate can safely rehydrate. */
export async function hydrateUploads(php:HydrationFilesystem,env:Env,uploaded:Map<string,string>):Promise<number>{
 if(!env.MEDIA)return 0;
 if(!env.MEDIA.list)throw new Error("R2 list binding required for safe media restoration");
 const listed=await env.MEDIA.list({prefix:"",limit:MAX_FILES+1});
 if(listed.truncated||listed.objects.length>MAX_FILES)throw new Error("Media hydration exceeds 32 files");
 let total=0,count=0;
 for(const item of listed.objects){
   const path="/wp-content/uploads/"+item.key;
   if(!mediaKey(path)||item.size>MAX_MEDIA_BYTES)throw new Error("Unsafe R2 media entry");
   total+=item.size;
   if(total>MAX_HYDRATION_BYTES)throw new Error("Media hydration exceeds 16 MiB");
   const object=await env.MEDIA.get(item.key);
   if(!object?.body)throw new Error("Missing R2 media object");
   const body=new Uint8Array(await new Response(object.body).arrayBuffer());
   if(body.byteLength!==item.size||!validMediaSignature(item.key,body))throw new Error("Corrupt R2 media object");
   const full="/www"+path;
   const parts=full.split("/");parts.pop();
   let dir="";
   for(const part of parts){
     if(!part)continue;
     dir+="/"+part;
     php.mkdir(dir);
   }
   php.writeFile(full,body);
   uploaded.set(full,await digest(body));
   count++;
 }
 return count;
}

/** Sync WordPress-created files to R2. Do not acknowledge request if a write/delete fails. */
export async function flushUploads(php:Filesystem,env:Env,uploaded:Map<string,string>):Promise<number>{
 const todo:string[]=[];
 if(php.isDir(ROOT)){
   function scan(dir:string,depth:number):void {
     if(depth>7)throw new Error("Uploads directory nesting exceeds limit");
     const entries=php.listFiles(dir);
     if(entries.length>500)throw new Error("Too many upload entries");
     for(const item of entries){
       if(!item||item==="."||item==="..")continue;
       if(item.includes("/")||item.includes("\\")||item.startsWith("."))throw new Error("Unsafe upload filename");
       const full=dir+"/"+item;
       if(php.isDir(full))scan(full,depth+1);
       else if(php.isFile(full)){
         if(!mediaKey(full.slice(4)))throw new Error("Disallowed upload file");
         todo.push(full);
         if(todo.length>MAX_FILES)throw new Error("Too many uploads");
       }
     }
   }
   scan(ROOT,0);
 }
 if((todo.length||uploaded.size)&&!env.MEDIA)throw new Error("R2 binding required to persist WordPress media");
 let count=0;
 for(const path of todo){
   const bytes=php.readFileAsBuffer(path);
   if(bytes.byteLength>MAX_MEDIA_BYTES)throw new Error("Media exceeds 10MB");
   const sha=await digest(bytes);
   if(uploaded.get(path)===sha)continue;
   await putMedia(env,path.slice(4),bytes);
   uploaded.set(path,sha);
   count++;
 }
 for(const path of [...uploaded.keys()]){
   if(todo.includes(path))continue;
   if(!env.MEDIA?.delete)throw new Error("R2 deletion support required");
   const key=mediaKey(path.slice(4));
   if(!key)throw new Error("Unsafe uploaded path");
   await env.MEDIA.delete(key);
   uploaded.delete(path);
   count++;
 }
 return count;
}
