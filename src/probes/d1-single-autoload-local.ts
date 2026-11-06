/**
 * Local Workerd D1 proof of one site-scoped SELECT (one D1 query).
 * DO NOT deploy this fixture Worker: fixed local-only mutations are present.
 * No public routes, request-provided SQL, site IDs, or account credentials.
 */
import {loadSingleWordPressAutoloadOptions} from "../php/d1-wpdb-conformance/options-single";

interface Env {DB:D1Database}
const QUERY="SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";
const CONFIG={table:"wp_options",scope:{column:"site_id",value:"site_a"}} as const;

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method!=="POST"||url.hostname!=="127.0.0.1"||
       url.search||url.hash||request.headers.get("content-length")!=="0"){
      return new Response("Not Found",{status:404});
    }
    const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
    if(url.pathname==="/__local/read"){
      try{
        const options=await loadSingleWordPressAutoloadOptions(QUERY,CONFIG,env.DB);
        const keys=Object.keys(options);
        return Response.json({ok:true,count:keys.length,
          first:keys[0]??null,last:keys.at(-1)??null,
          firstValue:options["option_0000"]??null,
          otherSitePresent:Object.values(options).some(v=>v.startsWith("private_"))},
          {headers});
      }catch{
        return Response.json({ok:false,error:"SINGLE_AUTOLOAD_READ_REJECTED"},
          {status:503,headers});
      }
    }
    if(url.pathname==="/__local/update"){
      await env.DB.prepare(
        "UPDATE wp_options SET option_value = ? WHERE site_id = ? AND option_name = ?"
      ).bind("updated","site_a","option_0000").run();
      return new Response(null,{status:204,headers});
    }
    if(url.pathname==="/__local/fill-500"){
      await env.DB.prepare(
        "WITH RECURSIVE seq(n) AS (SELECT 65 UNION ALL SELECT n + 1 FROM seq WHERE n < 499) "+
        "INSERT INTO wp_options(site_id,option_name,option_value,autoload) "+
        "SELECT ?, 'option_' || printf('%04d',n), 'value_' || n, 'yes' FROM seq"
      ).bind("site_a").run();
      return new Response(null,{status:204,headers});
    }
    if(url.pathname==="/__local/overflow-one"){
      await env.DB.prepare(
        "INSERT INTO wp_options(site_id,option_name,option_value,autoload) VALUES(?,?,?,?)"
      ).bind("site_a","option_0500","value_500","yes").run();
      return new Response(null,{status:204,headers});
    }
    return new Response("Not Found",{status:404,headers});
  }
};
