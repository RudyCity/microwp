import type {PHP} from "@php-wasm/universal";
import type {Env} from "../types";
import {mediaKey,MAX_MEDIA_BYTES,putMedia} from "../media";

/** R2 write-through for WordPress uploads created inside the PHP MEMFS request. */
const ROOT="/www/wp-content/uploads";
const MAX_FILES=32;
export async function flushUploads(php:Pick<PHP,"isDir"|"isFile"|"listFiles"|"readFileAsBuffer">,env:Env,uploaded:Map<string,string>):Promise<number> {
  if(!php.isDir(ROOT))return 0;
  const todo:string[]=[];
  function scan(dir:string,depth:number):void {
    if(depth>7)throw new Error("Uploads directory nesting exceeds limit");
    const entries=php.listFiles(dir);
    if(entries.length>500)throw new Error("Too many uploads directory entries");
    for(const item of entries){
      if(!item||item==="."||item==="..")continue;
      if(item.includes("/")||item.includes("\\")||item.startsWith("."))throw new Error("Unsafe upload filename");
      const full=dir+"/"+item;
      if(php.isDir(full))scan(full,depth+1);
      else if(php.isFile(full)) {
        if(!mediaKey(full.slice(4)))throw new Error("Disallowed file in uploads");
        todo.push(full);
        if(todo.length>MAX_FILES)throw new Error("Too many uploads in isolate");
      }
    }
  }
  scan(ROOT,0);
  if(todo.length&&!env.MEDIA)throw new Error("R2 binding required to persist WordPress media");
  let count=0;
  for(const path of todo){
    const bytes=php.readFileAsBuffer(path);
    if(bytes.byteLength>MAX_MEDIA_BYTES)throw new Error("Uploaded media exceeds 10MB limit");
    const sig=`${bytes.byteLength}:${Array.from(bytes.subarray(0,16)).join(",")}:${Array.from(bytes.subarray(Math.max(0,bytes.byteLength-8))).join(",")}`;
    if(uploaded.get(path)===sig)continue;
    await putMedia(env,path.slice(4),bytes);
    uploaded.set(path,sig);
    count++;
  }
  return count;
}
