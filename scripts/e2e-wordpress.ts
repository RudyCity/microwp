import { mkdir,readFile,writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const base=process.env.MICROWP_E2E_URL??"http://127.0.0.1:8796";
const authBasename=process.env.MICROWP_E2E_AUTH_BASENAME??"e2e-local-auth.json";
if(!/^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(authBasename)){
 throw Error("Unsafe local WordPress E2E auth fixture basename");
}
const authPath=join(".wrangler",authBasename);
const mode=process.argv[2]??"install";
const output = (label:string,ok:boolean,detail="") => { console.log((ok?"PASS ":"FAIL ")+label+(detail?" — "+detail:""));if(!ok)process.exitCode=1; };
async function get(path:string,init:RequestInit={}){return fetch(base+path,{redirect:"manual",...init});}
async function setup(){
 const home=await get("/");
 output("Uninstalled WordPress redirects to installer",home.status===302, String(home.status));
 const installer=await get("/wp-admin/install.php?step=1");
 const html=await installer.text();
 output("Original WordPress installer available",installer.status===200&&html.includes("weblog_title"),String(installer.status));
 if(installer.status!==200 || !html.includes("weblog_title")) return;
 const auth={username:"microwp_e2e_"+randomBytes(3).toString("hex"),password:randomBytes(24).toString("hex"),email:"demo@example.invalid",title:"microWP E2E Preview "+randomBytes(3).toString("hex")};
 const fields=new URLSearchParams({weblog_title:auth.title,user_name:auth.username,admin_password:auth.password,admin_password2:auth.password,admin_email:auth.email,blog_public:"0",Submit:"Install WordPress",language:""});
 const install=await get("/wp-admin/install.php?step=2",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:fields});
 const installHtml=await install.text();
 output("WordPress official installation",install.status===200&&installHtml.includes("Success!"),String(install.status)+" "+installHtml.slice(0,150).replace(/\s+/g," "));
 if(install.status!==200 || !installHtml.includes("Success!"))return;
 await mkdir(".wrangler",{recursive:true});
 await writeFile(authPath,JSON.stringify(auth)+"\n",{encoding:"utf8",mode:0o600});
 await verify(false);
 const login=new URLSearchParams({log:auth.username,pwd:auth.password,"wp-submit":"Log In",redirect_to:base+"/wp-admin/",testcookie:"1"});
 const response=await get("/wp-login.php",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cookie":"wordpress_test_cookie=WP%20Cookie%20check"},body:login});
 const cookies=response.headers.getSetCookie();
 const session=cookies.filter(x=>/wordpress_logged_in|wordpress_sec/.test(x));
 output("WordPress login returns authenticated cookies",[302,303].includes(response.status)&&session.length>0,String(response.status)+" cookies="+session.length);
 if(session.length>0){
  const sessionHeader=cookies.map(v=>v.split(";")[0]).filter(Boolean).join("; ");
  await writeFile(authPath,JSON.stringify({...auth,sessionHeader})+String.fromCharCode(10),{encoding:"utf8",mode:0o600});
 }
}
async function verify(fromRestart:boolean){
 const auth=JSON.parse(await readFile(authPath,"utf8")) as {title:string;username:string;password:string};
 const page=await get("/");
 const content=await page.text();
 output(fromRestart?"WordPress homepage survives worker restart":"WordPress homepage after install",page.status===200&&content.includes(auth.title),String(page.status));
 const login=await get("/wp-login.php");
 const loginHtml=await login.text();
 output("Login form available",login.status===200&&loginHtml.includes("user_login"),String(login.status));
 const installer=await get("/wp-admin/install.php");
 const html=await installer.text();
 output("WordPress recognizes an installed database",!html.includes("weblog_title"),String(installer.status));
 if(fromRestart){
  const persistedSession=(auth as {sessionHeader?:string}).sessionHeader;
  if(persistedSession){
   const admin=await get("/wp-admin/",{headers:{Cookie:persistedSession}});
   output("Authenticated dashboard session survives restart",admin.status===200,String(admin.status));
   const dashboard=await admin.text();
   output("WordPress REST settings exposed in authenticated dashboard",admin.status===200&&dashboard.includes("wpApiSettings"),"dashboard bytes="+dashboard.length);
   const at=dashboard.indexOf("wpApiSettings");
   const restNonce=at>=0?dashboard.slice(at,at+600).match(/\"nonce\"\s*:\s*\"([a-f0-9]{10})\"/):null;
   output("REST nonce is available for authenticated requests",Boolean(restNonce),"nonce present="+Boolean(restNonce));
   const postId=(auth as {postId?:number}).postId;
   const postTitle=(auth as {postTitle?:string}).postTitle;
   if(postId&&postTitle){
     const published=await get("/?rest_route=/wp/v2/posts/"+postId);
     const detail=await published.text();
     output("Published article survives restart",published.status===200&&detail.includes(postTitle),String(published.status));
     const front=await get("/?p="+postId);
     const rendered=await front.text();
     output("Published page renders after restart",front.status===200&&rendered.includes(postTitle),String(front.status));
   const mediaPath=(auth as {mediaPath?:string}).mediaPath;
   if(mediaPath){
     const media=await get(mediaPath);
     const image=await media.arrayBuffer();
     output("R2 media is still accessible after restart",media.status===200&&image.byteLength>30,String(media.status));
   }

   }


  }
 }
}
async function publish(){
 const fixture=JSON.parse(await readFile(authPath,"utf8")) as {sessionHeader?:string;postId?:number;postTitle?:string};
 if(!fixture.sessionHeader)throw new Error("Missing local demo session fixture");
 const dashboard=await get("/wp-admin/",{headers:{Cookie:fixture.sessionHeader}});
 const page=await dashboard.text();
 const at=page.indexOf("wpApiSettings");
 const nonce=at>=0?page.slice(at,at+600).match(/"nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1]:undefined;
 output("Authenticated WordPress REST nonce",dashboard.status===200&&!!nonce,String(dashboard.status));
 if(!nonce)return;
 const headers={"Cookie":fixture.sessionHeader,"X-WP-Nonce":nonce,"Content-Type":"application/json"};
 const title="microWP Persisted Article " + randomBytes(4).toString("hex");
 const created=await get("/?rest_route=/wp/v2/posts",{method:"POST",headers,body:JSON.stringify({title,content:"WordPress native WASM database persistence E2E",status:"publish"})});
 const body=await created.text();
 let payload:any;try{payload=JSON.parse(body)}catch{payload={}};
 output("WordPress REST publish post",created.status===201 && Number.isInteger(payload.id),String(created.status)+(payload.code?" code="+payload.code:""));
 if(created.status!==201||!Number.isInteger(payload.id))return;
 const updatedTitle=title+" Edited";
 const updated=await get("/?rest_route=/wp/v2/posts/"+payload.id,{method:"POST",headers,body:JSON.stringify({title:updatedTitle,content:"Article updated through authenticated REST",status:"publish"})});
 const updateBody=await updated.text();let updatePayload:any;try{updatePayload=JSON.parse(updateBody)}catch{updatePayload={}};
 output("WordPress REST update post",updated.status===200 && updatePayload.id===payload.id,String(updated.status)+(updatePayload.code?" code="+updatePayload.code:""));
 if(updated.status===200){
   await writeFile(authPath,JSON.stringify({...fixture,postId:payload.id,postTitle:updatedTitle})+String.fromCharCode(10));
 }
}
async function upload(){
 const fixture=JSON.parse(await readFile(authPath,"utf8")) as {sessionHeader?:string};
 if(!fixture.sessionHeader)throw new Error("Missing local demo WordPress session");
 const dashboard=await get("/wp-admin/",{headers:{Cookie:fixture.sessionHeader}});
 const page=await dashboard.text();
 const at=page.indexOf("wpApiSettings");
 const nonce=at>=0?page.slice(at,at+600).match(/"nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1]:undefined;
 output("Authenticated REST media nonce",dashboard.status===200&&!!nonce,String(dashboard.status));
 if(!nonce)return;
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0BPX8AAAAASUVORK5CYII=","base64");
 const payload=new ArrayBuffer(png.byteLength);new Uint8Array(payload).set(png);
 const response=await get("/?rest_route=/wp/v2/media",{method:"POST",headers:{"Cookie":fixture.sessionHeader,"X-WP-Nonce":nonce,"Content-Type":"image/png","Content-Disposition":"attachment; filename=microwp-e2e-pixel.png"},body:payload});
 const body=await response.text();let data:any;try{data=JSON.parse(body)}catch{data={}};
 output("WordPress REST accepts real PNG media",response.status===201&&Number.isInteger(data.id),String(response.status)+(data.code?" code="+data.code:""));
 if(response.status!==201||!Number.isInteger(data.id))return;
 const path=new URL(data.source_url).pathname;
 const file=await get(path);
 const bytes=new Uint8Array(await file.arrayBuffer());
 output("Media file served from local R2",file.status===200&&file.headers.get("content-type")==="image/png"&&bytes.length>30,String(file.status)+" bytes="+bytes.length);
 if(file.status===200)await writeFile(authPath,JSON.stringify({...fixture,mediaId:data.id,mediaPath:path})+String.fromCharCode(10));
}
async function deleteMedia(){
 const fixture=JSON.parse(await readFile(authPath,"utf8")) as {sessionHeader?:string;mediaId?:number;mediaPath?:string};
 if(!fixture.sessionHeader||!fixture.mediaId||!fixture.mediaPath)throw new Error("Missing local demo media fixture");
 const dashboard=await get("/wp-admin/",{headers:{Cookie:fixture.sessionHeader}});
 const page=await dashboard.text();
 const at=page.indexOf("wpApiSettings");
 const nonce=at>=0?page.slice(at,at+600).match(/"nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1]:undefined;
 output("Authenticated REST delete nonce",dashboard.status===200&&!!nonce,String(dashboard.status));
 if(!nonce)return;
 const deleted=await get("/?rest_route=/wp/v2/media/"+fixture.mediaId+"&force=true",{method:"DELETE",headers:{"Cookie":fixture.sessionHeader,"X-WP-Nonce":nonce}});
 const responseBody=await deleted.text();let data:any;try{data=JSON.parse(responseBody)}catch{data={}};
 output("WordPress REST delete media",deleted.status===200&&data.deleted===true,String(deleted.status)+(data.code?" code="+data.code:""));
 if(deleted.status!==200||data.deleted!==true)return;
 const media=await get(fixture.mediaPath);
 output("Deleted WordPress media also removed from R2",media.status===404,String(media.status));
 if(media.status===404){
   const {mediaId,mediaPath,...keep}=fixture;
   await writeFile(authPath,JSON.stringify(keep)+String.fromCharCode(10));
 }
}
if(mode==="install"){await setup();}
else if(mode==="verify"){await verify(true);}
else if(mode==="publish"){await publish();}
else if(mode==="upload"){await upload();}
else if(mode==="delete"){await deleteMedia();}
else if(mode==="diagnose"){
 const auth=JSON.parse(await readFile(authPath,"utf8")) as {username:string;password:string;title:string};
 const page=await get("/");const pageHtml=await page.text();
 console.log("HOME_DIAGNOSTIC",JSON.stringify({status:page.status,length:pageHtml.length,expectedTitlePresent:pageHtml.includes(auth.title),htmlPrefix:pageHtml.slice(0,250)}));
 const loginPage=await get("/wp-login.php");console.log("LOGIN_GET_STATUS",loginPage.status,"setCookieCount",loginPage.headers.getSetCookie().length);
 const data=new URLSearchParams({log:auth.username,pwd:auth.password,"wp-submit":"Log In",redirect_to:base+"/wp-admin/",testcookie:"1"});
 const res=await get("/wp-login.php",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cookie":"wordpress_test_cookie=WP%20Cookie%20check"},body:data});
 const html=await res.text();
 const matches=[...html.matchAll(/<(?:div|p|strong)[^>]*?(?:login_error|error|message)[^>]*>[\s\S]{0,800}?(?:<\/div>|<\/p>|<\/strong>)/gi)].slice(0,3).map(x=>x[0].replace(/<[^>]*>/g," ").replace(/\s+/g," ").slice(0,300));
 console.log("LOGIN_POST_DIAGNOSTIC",JSON.stringify({status:res.status,location:res.headers.get("location"),cookieCount:res.headers.getSetCookie().length,errors:matches,htmlLen:html.length}));
}
else throw new Error("usage: bun scripts/e2e-wordpress.ts install|verify");
