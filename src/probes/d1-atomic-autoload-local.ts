/**
 * Localhost-only Workerd proof for Cloudflare D1 transactional batch reads.
 * NEVER deploy: contains deliberately fixed proof mutations on isolated D1.
 * No request-supplied SQL, site/table identifiers, user data or credentials.
 */
import {loadAtomicWordPressAutoloadOptions} from "../php/d1-wpdb-conformance/options-atomic";

interface LocalEnv {DB:D1Database}
const QUERY="SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";
const CONFIG={table:"wp_options",scope:{column:"site_id",value:"site_a"}} as const;

export default {
 async fetch(request:Request,env:LocalEnv):Promise<Response>{
  const url=new URL(request.url);
  if(request.method!=="POST"||url.hostname!=="127.0.0.1"||
     url.search||url.hash||request.headers.get("content-length")!=="0"){
   return new Response("Not Found",{status:404});
  }
  const headers={"Cache-Control":"no-store"};
  if(url.pathname==="/__local/read"){
   try{
    const options=await loadAtomicWordPressAutoloadOptions(QUERY,CONFIG,env.DB);
    const keys=Object.keys(options);
    return Response.json({ok:true,count:keys.length,
      first:keys[0]??null,last:keys.at(-1)??null,
      firstValue:options["option_0000"]??null,
      siteBCanaryPresent:Object.values(options).some(v=>v.startsWith("private_"))},
      {headers});
   }catch{
    return Response.json({ok:false,error:"ATOMIC_AUTOLOAD_READ_REJECTED"},
      {status:503,headers});
   }
  }
  if(url.pathname==="/__local/update"){
   await env.DB.prepare(
    "UPDATE wp_options SET option_value = ? WHERE site_id = ? AND option_name = ?"
   ).bind("updated","site_a","option_0000").run();
   return new Response(null,{status:204,headers});
  }
  if(url.pathname==="/__local/overflow"){
   await env.DB.prepare(
    "WITH RECURSIVE seq(n) AS (SELECT 65 UNION ALL SELECT n + 1 FROM seq WHERE n < 500) "+
    "INSERT INTO wp_options(site_id,option_name,option_value,autoload) "+
    "SELECT ?, 'option_' || printf('%04d',n), 'value_' || n, 'yes' FROM seq"
   ).bind("site_a").run();
   return new Response(null,{status:204,headers});
  }
  return new Response("Not Found",{status:404,headers});
 }
};
