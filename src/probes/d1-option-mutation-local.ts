/**
 * Strictly local Cloudflare D1 option write proof. NEVER deploy.
 * Fixed localhost-only operations, fixed data, no HTTP-selected SQL/site/keys.
 */
import {mutateTrustedWordPressOption} from "../php/d1-wpdb-conformance/options-mutation";
import {createPrivateWordPressOptionStore} from "../php/d1-wpdb-conformance/options-store";
import {readPrivateWordPressMetadata} from "../php/d1-wpdb-conformance/schema-metadata";
import {executePinnedWordPressOptionUpsert,PINNED_WP_OPTION_UPSERT_TEMPLATE} from "../php/d1-wpdb-conformance/options-upsert-template";
import {readPrivateCorePostsByIds,readPrivatePostMetaByPostIds} from "../php/d1-wpdb-conformance/core-reads";
import {readPrivateUserAuthByLogin,readPrivateUserMetaByUserIds} from "../php/d1-wpdb-conformance/user-reads";
import {readPrivateObjectTerms} from "../php/d1-wpdb-conformance/taxonomy-reads";
import {insertPrivateCorePost,updatePrivateCorePost,insertPrivatePostMeta,updatePrivatePostMeta,deletePrivatePostMeta} from "../php/d1-wpdb-conformance/core-mutations";
import {countPrivateApprovedCommentsByPostIds,readPrivateCommentsByPostIds,insertPrivateComment,readPrivateCommentMetaByCommentIds} from "../php/d1-wpdb-conformance/comments";
interface Env {DB:D1Database}
const putCap=Object.freeze({hostOnly:"put"}),deleteCap=Object.freeze({hostOnly:"delete"});
const readCap=Object.freeze({hostOnly:"read"});
const schemaCap=Object.freeze({hostOnly:"schema"});
const postsCap=Object.freeze({hostOnly:"posts"}),postMetaCap=Object.freeze({hostOnly:"postmeta"});
const CORE_READ_CONFIG={scope:{column:"site_id",value:"site_a"},postsCapability:postsCap,postMetaCapability:postMetaCap} as const;
const userAuthCap=Object.freeze({hostOnly:"user-auth"}),userMetaCap=Object.freeze({hostOnly:"usermeta"});
const USER_READ_CONFIG={scope:{column:"site_id",value:"site_a"},authCapability:userAuthCap,userMetaCapability:userMetaCap} as const;
const taxonomyCap=Object.freeze({hostOnly:"taxonomy"});
const TAXONOMY_READ_CONFIG={scope:{column:"site_id",value:"site_a"},capability:taxonomyCap} as const;
const coreWriteCaps={
  postInsert:Object.freeze({hostOnly:"post-insert"}),
  postUpdate:Object.freeze({hostOnly:"post-update"}),
  postMetaInsert:Object.freeze({hostOnly:"postmeta-insert"}),
  postMetaUpdate:Object.freeze({hostOnly:"postmeta-update"}),
  postMetaDelete:Object.freeze({hostOnly:"postmeta-delete"})
};
const CORE_WRITE_CONFIG={scope:{column:"site_id",value:"site_a"},capabilities:coreWriteCaps} as const;
const commentCaps={
  read:Object.freeze({hostOnly:"comment-read"}),
  insert:Object.freeze({hostOnly:"comment-insert"}),
  metaRead:Object.freeze({hostOnly:"commentmeta-read"})
};
const COMMENT_CONFIG={scope:{column:"site_id",value:"site_a"},capabilities:commentCaps} as const;
const PROOF_POST={
  ID:5,post_author:7,post_parent:0,menu_order:0,comment_count:0,
  post_date:"2026-11-06 00:00:00",post_date_gmt:"2026-11-06 00:00:00",
  post_content:"native body",post_title:"Native D1 Draft",post_excerpt:"",
  post_status:"draft",comment_status:"open",ping_status:"open",post_password:"",
  post_name:"native-d1-draft",to_ping:"",pinged:"",
  post_modified:"2026-11-06 00:00:00",post_modified_gmt:"2026-11-06 00:00:00",
  post_content_filtered:"",guid:"https://example.test/?p=5",
  post_type:"post",post_mime_type:""
} as const;
const PROOF_COMMENT={
  comment_ID:30,comment_post_ID:1,comment_karma:0,comment_parent:0,user_id:1,
  comment_author:"Rudy",comment_author_email:"rudy@example.test",comment_author_url:"",
  comment_author_IP:"127.0.0.1",comment_date:"2026-11-06 00:00:00",
  comment_date_gmt:"2026-11-06 00:00:00",comment_content:"native D1 comment",
  comment_approved:"1",comment_agent:"microWP-local",comment_type:"comment"
} as const;
const SCHEMA_CONFIG={table:"wp_options",capability:schemaCap} as const;
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
      if(url.pathname==="/__local/core-write-insert"){
        const post=await insertPrivateCorePost(
          PROOF_POST,CORE_WRITE_CONFIG,env.DB,coreWriteCaps.postInsert
        );
        const meta=await insertPrivatePostMeta(
          {meta_id:30,post_id:5,meta_key:"color",meta_value:"blue"},
          CORE_WRITE_CONFIG,env.DB,coreWriteCaps.postMetaInsert
        );
        return Response.json({ok:true,post,meta},{headers:HEADERS});
      }
      if(url.pathname==="/__local/core-write-update"){
        const post=await updatePrivateCorePost(
          5,{post_title:"Native D1 Published",post_status:"publish"},
          CORE_WRITE_CONFIG,env.DB,coreWriteCaps.postUpdate
        );
        const meta=await updatePrivatePostMeta(
          30,{meta_value:"green"},CORE_WRITE_CONFIG,env.DB,coreWriteCaps.postMetaUpdate
        );
        return Response.json({ok:true,post,meta},{headers:HEADERS});
      }
      if(url.pathname==="/__local/core-write-state"){
        const posts=await readPrivateCorePostsByIds([5],CORE_READ_CONFIG,env.DB,postsCap);
        const meta=await readPrivatePostMetaByPostIds([5],CORE_READ_CONFIG,env.DB,postMetaCap);
        return Response.json({ok:true,posts,meta},{headers:HEADERS});
      }
      if(url.pathname==="/__local/core-meta-delete"){
        const meta=await deletePrivatePostMeta(
          30,CORE_WRITE_CONFIG,env.DB,coreWriteCaps.postMetaDelete
        );
        return Response.json({ok:true,meta},{headers:HEADERS});
      }
      if(url.pathname==="/__local/comments-read"){
        const counts=await countPrivateApprovedCommentsByPostIds(
          [3,2,1],["1"],COMMENT_CONFIG,env.DB,commentCaps.read
        );
        const rows=await readPrivateCommentsByPostIds(
          [3,2,1],COMMENT_CONFIG,env.DB,commentCaps.read
        );
        const meta=await readPrivateCommentMetaByCommentIds(
          [12,10],COMMENT_CONFIG,env.DB,commentCaps.metaRead
        );
        return Response.json({ok:true,counts,rows,meta},{headers:HEADERS});
      }
      if(url.pathname==="/__local/comment-insert"){
        const result=await insertPrivateComment(
          PROOF_COMMENT,COMMENT_CONFIG,env.DB,commentCaps.insert
        );
        return Response.json({ok:true,result},{headers:HEADERS});
      }
      if(url.pathname==="/__local/taxonomy-read"){
        const rows=await readPrivateObjectTerms(
          [3,2,1],["category","post_tag"],TAXONOMY_READ_CONFIG,env.DB,taxonomyCap
        );
        return Response.json({ok:true,rows},{headers:HEADERS});
      }
      if(url.pathname==="/__local/user-auth-read"){
        const row=await readPrivateUserAuthByLogin("admin",USER_READ_CONFIG,env.DB,userAuthCap);
        if(!row)throw Error("Missing local user");
        return Response.json({ok:true,ID:row.ID,user_login:row.user_login,
          user_pass:row.user_pass,user_status:row.user_status},{headers:HEADERS});
      }
      if(url.pathname==="/__local/usermeta-read"){
        const rows=await readPrivateUserMetaByUserIds([2,1],USER_READ_CONFIG,env.DB,userMetaCap);
        return Response.json({ok:true,rows},{headers:HEADERS});
      }
      if(url.pathname==="/__local/core-posts-read"){
        const rows=await readPrivateCorePostsByIds([3,2,1],CORE_READ_CONFIG,env.DB,postsCap);
        return Response.json({ok:true,ids:rows.map(row=>row.ID),
          titles:rows.map(row=>row.post_title),statuses:rows.map(row=>row.post_status)},
          {headers:HEADERS});
      }
      if(url.pathname==="/__local/core-postmeta-read"){
        const rows=await readPrivatePostMetaByPostIds([3,2,1],CORE_READ_CONFIG,env.DB,postMetaCap);
        return Response.json({ok:true,rows},{headers:HEADERS});
      }
      if(url.pathname==="/__local/template-option-insert"||
         url.pathname==="/__local/template-option-update"){
        const isUpdate=url.pathname==="/__local/template-option-update";
        const mutation=await executePinnedWordPressOptionUpsert(
          PINNED_WP_OPTION_UPSERT_TEMPLATE,
          ["template_option",isUpdate?"updated":"created",isUpdate?"off":"no"],
          CONFIG,env.DB,putCap
        );
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const after=await store.get("template_option",readCap);
        return Response.json({ok:true,mutation,after},{headers:HEADERS});
      }
      if(url.pathname==="/__local/template-option-read"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const value=await store.get("template_option",readCap);
        return Response.json({ok:true,value,queries:store.usedQueries},{headers:HEADERS});
      }
      if(url.pathname==="/__local/template-option-delete"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const mutation=await store.delete("template_option",deleteCap);
        return Response.json({ok:true,mutation},{headers:HEADERS});
      }
      if(url.pathname==="/__local/schema-exists"){
        const metadata=await readPrivateWordPressMetadata(
          "SHOW TABLES LIKE 'wp_options'",SCHEMA_CONFIG,env.DB,schemaCap
        );
        return Response.json({ok:true,...metadata},{headers:HEADERS});
      }
      if(url.pathname==="/__local/schema-describe"){
        const metadata=await readPrivateWordPressMetadata(
          "DESCRIBE wp_options",SCHEMA_CONFIG,env.DB,schemaCap
        );
        return Response.json({ok:true,...metadata},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-batch-read"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const result=await store.getMany(["shared","missing","__proto__"],readCap);
        return Response.json({ok:true,values:result.values,requested:result.requested,
          found:result.found,queries:store.usedQueries},{headers:HEADERS});
      }
      if(url.pathname==="/__local/store-batch-budget"){
        const store=createPrivateWordPressOptionStore(STORE_CONFIG,env.DB);
        const keys=Array.from({length:96},(_,i)=>"missing_"+String(i).padStart(3,"0"));
        const result=await store.getMany(keys,readCap);
        for(let i=0;i<49;i++)await store.getMany(["missing"],readCap);
        const used=store.usedQueries;
        let rejected=false;
        try{await store.getMany(["missing"],readCap)}catch{rejected=true;}
        return Response.json({ok:true,requested:result.requested,found:result.found,
          used,rejected,remaining:store.remainingQueries},{headers:HEADERS});
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
