/**
 * Strictly local Cloudflare D1 option write proof. NEVER deploy.
 * Fixed localhost-only operations, fixed data, no HTTP-selected SQL/site/keys.
 */
import {mutateTrustedWordPressOption} from "../php/d1-wpdb-conformance/options-mutation";
import {createPrivateWordPressOptionStore} from "../php/d1-wpdb-conformance/options-store";
interface Env {DB:D1Database}
const putCap=Object.freeze({hostOnly:"put"}),deleteCap=Object.freeze({hostOnly:"delete"});
const readCap=Object.freeze({hostOnly:"read"});
const CONFIG={table:"wp_options",scope:{column:"site_id",value:"site_a"},
  writeCapabilities:{put:putCap,delete:deleteCap}} as const;
const STORE_CONFIG={...CONFIG,readCapability:readCap};
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function closed(){return new Response("Not Found",{status:404,headers:HEADERS});}
function error(){return Response.json({ok:false,error:"OPTION_PROOF_REJECTED"},
  {status:503,headers:HEADERS});}
async function read(db:D1Database){
  const results=await db.prepare(
    'SELECT "site_id","option_value","autoload" FROM "wp_options" WHERE "option_name" = ? ORDER BY "site_id"'
  ).bind("shared").all<{site_id:string;option_value:string;autoload:string}>();
  if(!results.success||!Array.isArray(results.results))throw Error("Local D1 failed");
  const rows=results.results;
  if(rows.length>2||rows.some(x=>x.site_id!=="site_a"&&x.site_id!=="site_b"))
    throw Error("Local D1 response invalid");
  return rows;
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method!=="POST"||url.hostname!=="127.0.0.1"||
       url.search||url.hash||request.headers.get("content-length")!=="0")return closed();
    try{
      if(url.pathname==="/__local/read"){
        return Response.json({ok:true,rows:await read(env.DB)},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-read"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const option=await store.get("shared",readCap);
        const all=await store.all(readCap);
        return Response.json({ok:true,option,autoloadKeys:Object.keys(all),
          autoloadValue:all["shared"]??null,queries:store.usedQueries},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-put"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const changed=await store.put("shared","site_a_store","on",putCap);
        const option=await store.get("shared",readCap);
        const all=await store.all(readCap);
        return Response.json({ok:true,changed,option,autoloadValue:all["shared"]??null,
          queries:store.usedQueries},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-delete"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const changed=await store.delete("shared",deleteCap);
        const after=await store.get("shared",readCap);
        return Response.json({ok:true,changed,after,queries:store.usedQueries},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-budget"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        for(let i=0;i<49;i++)await store.get("missing",readCap);
        let rejectedTwoQuery=false;
        try{await store.delete("missing",deleteCap)}catch{rejectedTwoQuery=true;}
        await store.get("missing",readCap);
        let rejectedExtra=false;
        try{await store.get("missing",readCap)}catch{rejectedExtra=true;}
        return Response.json({ok:true,used:store.usedQueries,
          remaining:store.remainingQueries,rejectedTwoQuery,rejectedExtra},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-wrong-capability"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        let rejected=false;
        try{await store.get("shared",putCap)}catch{rejected=true;}
        return Response.json({ok:true,rejected,used:store.usedQueries},{headers:HEADERS});
      }
      if(url.pathname==="/__local/put"){
        const result=await mutateTrustedWordPressOption({
          op:"put",name:"shared",value:"site_a_initial",autoload:"on"
        },CONFIG,env.DB,putCap);
        return Response.json({ok:true,...result},{headers:HEADERS});
      }
      if(url.pathname==="/__local/update"){
        const result=await mutateTrustedWordPressOption({
          op:"put",name:"shared",value:"site_a_updated",autoload:"auto-on"
        },CONFIG,env.DB,putCap);
        return Response.json({ok:true,...result},{headers:HEADERS});
      }
      if(url.pathname==="/__local/delete"){
        const result=await mutateTrustedWordPressOption({
          op:"delete",name:"shared"
        },CONFIG,env.DB,deleteCap);
        return Response.json({ok:true,...result},{headers:HEADERS});
      }
      if(url.pathname==="/__local/deny-crossed-capability"){
        try{
          await mutateTrustedWordPressOption(
            {op:"delete",name:"shared"},CONFIG,env.DB,putCap);
        }catch{
          return Response.json({ok:true,capabilityRejected:true},{headers:HEADERS});
        }
        return error();
      }
      return closed();
    }catch{return error();}
  }
};
