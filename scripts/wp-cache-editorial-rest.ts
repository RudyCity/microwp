/**
 * LOCAL-ONLY real WordPress REST editorial verification with cache drop-in on.
 * Runs against a loopback WordPress Worker, with randomly generated local
 * credentials stored in the ignored .wrangler/ fixture.
 */
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
const base=process.env.MICROWP_E2E_URL??"http://127.0.0.1:19152";
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error("Local-only editorial probe origin required");
const fixture=process.env.MICROWP_E2E_AUTH_BASENAME??"wp-cache-editorial-auth.json";
if(!/^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(fixture))throw Error("Invalid local E2E fixture name");
const path=join(".wrangler",fixture);
type Auth={
 username:string;password:string;title:string;sessionHeader:string;
 postId:number;postTitle:string;categoryId?:number;categoryName?:string;
};
const verifyOnly=process.argv[2]==="verify";
const auth=JSON.parse(await readFile(path,"utf8")) as Auth;
if(!auth.sessionHeader||!auth.postId)throw Error("Missing isolated WordPress editorial fixture");
async function call(url:string,init:RequestInit={}) {
 return fetch(base+url,{redirect:"manual",signal:AbortSignal.timeout(30000),...init});
}
async function data(url:string,init:RequestInit={}) {
 const response=await call(url,init);
 const body=await response.text();
 let decoded:Record<string,unknown>={};
 try{decoded=JSON.parse(body)}catch{}
 return {status:response.status,body:decoded,text:body};
}
function assert(ok:unknown,label:string,details?:string):asserts ok {
 if(!ok)throw Error("FAIL "+label+(details?": "+details:""));
 console.log("PASS "+label);
}
if(verifyOnly){
 const category=await data("/?rest_route=/wp/v2/categories/"+auth.categoryId);
 assert(category.status===200&&category.body.name===auth.categoryName,"category changes survive Worker restart");
 const post=await data("/?rest_route=/wp/v2/posts/"+auth.postId);
 const categories=post.body.categories;
 assert(post.status===200&&Array.isArray(categories)&&categories.includes(auth.categoryId),
   "post/category relationship survives Worker restart");
 const dashboard=await call("/wp-admin/",{headers:{Cookie:auth.sessionHeader}});
 const html=await dashboard.text();
 const idx=html.indexOf("wpApiSettings");
 const nonce=idx>=0?html.slice(idx,idx+700).match(/"nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1]:null;
 assert(dashboard.status===200&&!!nonce,"REST nonce survives WordPress login session after restart");
 const settings=await data("/?rest_route=/wp/v2/settings",{
  headers:{Cookie:auth.sessionHeader,"X-WP-Nonce":nonce!}
 });
 assert(settings.status===200&&settings.body.title===auth.title,
  "public site title option survives Worker restart",String(settings.status));
 const front=await call("/");
 assert(front.status===200&&(await front.text()).includes(auth.title),"WordPress homepage renders updated public title after restart");
}else{
 const dashboard=await call("/wp-admin/",{headers:{Cookie:auth.sessionHeader}});
 const html=await dashboard.text();
 const at=html.indexOf("wpApiSettings");
 const nonce=at>=0?html.slice(at,at+700).match(/"nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1]:null;
 assert(dashboard.status===200&&!!nonce,"authenticated WordPress dashboard yields REST nonce");
 const headers={Cookie:auth.sessionHeader,"X-WP-Nonce":nonce!,"Content-Type":"application/json"};
 const categoryName="Cache Editorial Category "+crypto.randomUUID().slice(0,8);
 const created=await data("/?rest_route=/wp/v2/categories",{method:"POST",headers,body:JSON.stringify({name:categoryName})});
 assert(created.status===201&&Number.isInteger(created.body.id),"create WordPress category through authenticated REST",created.text.slice(0,180));
 const categoryId=created.body.id as number;
 const updatedName=categoryName+" Updated";
 const renamed=await data("/?rest_route=/wp/v2/categories/"+categoryId,{
  method:"POST",headers,body:JSON.stringify({name:updatedName})
 });
 assert(renamed.status===200&&renamed.body.name===updatedName,"rename WordPress category",renamed.text.slice(0,180));
 const assigned=await data("/?rest_route=/wp/v2/posts/"+auth.postId,{
  method:"POST",headers,body:JSON.stringify({categories:[categoryId]})
 });
 assert(assigned.status===200&&Array.isArray(assigned.body.categories)&&assigned.body.categories.includes(categoryId),
  "assign category to existing published WordPress post",assigned.text.slice(0,160));
 const title=auth.title+" Cache Edited";
 const settings=await data("/?rest_route=/wp/v2/settings",{
  method:"POST",headers,body:JSON.stringify({title})
 });
 assert(settings.status===200&&settings.body.title===title,"edit public site-title WordPress option",settings.text.slice(0,170));
 const category=await data("/?rest_route=/wp/v2/categories/"+categoryId);
 assert(category.status===200&&category.body.name===updatedName,"category REST reflects latest name without stale cache");
 const post=await data("/?rest_route=/wp/v2/posts/"+auth.postId);
 assert(post.status===200&&Array.isArray(post.body.categories)&&post.body.categories.includes(categoryId),
  "published post REST reflects new taxonomy relationship");
 const front=await call("/");
 assert(front.status===200&&(await front.text()).includes(title),"WordPress public HTML reflects latest title setting");
 await writeFile(path,JSON.stringify({...auth,title,categoryId,categoryName:updatedName})+"\n",{mode:0o600});
}
