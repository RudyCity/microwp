/**
 * Fixed LOCAL-ONLY proof: WordPress PHP + wp_cache_* via private Service Binding.
 * Not reachable in deployed WordPress or staging config.
 */
import {getPHP} from "./native";
import {handleObjectCacheMessage,OBJECT_CACHE_MESSAGE_PREFIX} from "./worker-object-cache-bridge";
import type {Env} from "../types";

const prefix=[
 "<?php",
 "define('ABSPATH','/www/');",
 "define('WPINC','wp-includes');",
 "function is_multisite(){return false;}",
 "require '/www/wp-content/object-cache.php';",
 "wp_cache_init();",
].join("\n")+"\n";
function text(response:{bytes:Uint8Array}):string{return new TextDecoder().decode(response.bytes)}

export async function runLocalWordPressObjectCacheProof(env:Env):Promise<{
 ok:boolean;phpDropin:boolean;crossRequest:boolean;invalidated:boolean;wordpressInstaller:boolean
}>{
 if(env.MICROWP_WORKER_CACHE_ENABLED!=="yes"||!env.REDIS_WORKER)
  throw Error("Explicit local-only object-cache binding required");
 const php=await getPHP("http://127.0.0.1",env);
 const stop=php.onMessage(async message=>{
  if(!message.startsWith(OBJECT_CACHE_MESSAGE_PREFIX))return "";
  return handleObjectCacheMessage(message,env.REDIS_WORKER!,"microwp_single_site");
 });
 try{
  const key="home:v0123456789abcdef";
  const first=await php.run({code:prefix+
   "$ok=($wp_object_cache instanceof MicroWP_Worker_Object_Cache) &&"+
   "wp_cache_set('"+key+"',array('title'=>'hello'),'microwp_public',30);"+
   "echo $ok?'DROPIN_OK':'DROPIN_FAILED';"});
  const second=await php.run({code:prefix+
   "$found=false;$value=wp_cache_get('"+key+"','microwp_public',false,$found);"+
   "echo ($found && $value===array('title'=>'hello'))?'CACHE_HIT':'CACHE_MISS';"+
   "wp_cache_flush_group('microwp_public');"});
  const third=await php.run({code:prefix+
   "$found=false;wp_cache_get('"+key+"','microwp_public',false,$found);"+
   "echo $found?'STALE':'INVALIDATED';"});
  const phpDropin=first.exitCode===0&&text(first).includes("DROPIN_OK");
  const crossRequest=second.exitCode===0&&text(second).includes("CACHE_HIT");
  const invalidated=third.exitCode===0&&text(third).includes("INVALIDATED");
  const installer=await php.run({
   scriptPath:"/www/wp-admin/install.php",
   relativeUri:"/wp-admin/install.php?step=1",
   method:"GET",protocol:"http",
   $_SERVER:{
    HTTP_HOST:"127.0.0.1",SERVER_NAME:"127.0.0.1",SERVER_PORT:"80",
    DOCUMENT_ROOT:"/www",SCRIPT_FILENAME:"/www/wp-admin/install.php",
    SCRIPT_NAME:"/wp-admin/install.php",
   }
  });
  const wordpressInstaller=installer.exitCode===0&&installer.httpStatusCode===200&&
   text(installer).includes("weblog_title");
  return {ok:phpDropin&&crossRequest&&invalidated&&wordpressInstaller,
   phpDropin,crossRequest,invalidated,wordpressInstaller};
 }finally{await stop()}
}
