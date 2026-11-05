import {describe,expect,test} from "bun:test";
import {handleFreePublicRequest,type FreePreviewEnv} from "../src/free-site/public-edge";

const base="https://example.test";
function env(args:Record<string,unknown>={}):FreePreviewEnv{
 return {MICROWP_FREE_PREVIEW_MODE:"enabled",...args} as FreePreviewEnv;
}
function req(path:string,method="GET"):Request{
 return new Request(base+path,{method});
}
describe("read-only Free-tier public delivery prototype",()=>{
 test("opt-in required before any database/asset read",async()=>{
  let calls=0;
  const res=await handleFreePublicRequest(req("/"),env({
   MICROWP_FREE_PREVIEW_MODE:"disabled",
   ASSETS:{fetch:async()=>{calls++;return new Response("oops")}},
  }));
  expect(res.status).toBe(503);
  expect(calls).toBe(0);
 });
 test("WordPress backend, PHP, secrets and mutating HTTP methods stay disabled",async()=>{
  let calls=0;
  const e=env({ASSETS:{fetch:async()=>{calls++;return new Response("oops")}}});
  for(const path of ["/wp-admin/","/wp-login.php","/xmlrpc.php","/wp-json/wp/v2/posts",
    "/wp-config.php","/wp-includes/wp-db.php","/wp-content/uploads/malware.php",
    "/__microwp/health","/backup.sql","/.env"]){
    expect((await handleFreePublicRequest(req(path),e)).status).toBe(404);
  }
  expect((await handleFreePublicRequest(req("/hello","POST"),e)).status).toBe(405);
  expect((await handleFreePublicRequest(req("/wp-content/uploads/a.jpg","DELETE"),e)).status).toBe(405);
  expect(calls).toBe(0);
 });
 test("trusted prerendered static HTML uses asset binding only; no PHP",async()=>{
  let pathSeen="";
  const res=await handleFreePublicRequest(req("/2026/11/post/"),env({
   ASSETS:{fetch:async(r:Request)=>{pathSeen=new URL(r.url).pathname;return new Response("<h1>Static</h1>",{headers:{"Content-Type":"text/html"}})}},
  }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("<h1>Static</h1>");
  expect(pathSeen).toBe("/2026/11/post/");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
 });
 test("D1 post listing has fixed SQL, published-only filter, no client SQL and bounded rows",async()=>{
  let prepared="",args:unknown[]=[];
  const fakeDb={prepare(sql:string){prepared=sql;return{bind(...params:unknown[]){args=params;return{all:async()=>({
    success:true,results:[{slug:"hello",title:"A < B",excerpt:"text",published_at:"2026-11-06T00:00:00Z"}],
  })}}}}};
  const res=await handleFreePublicRequest(req("/__microwp/free/posts?sql=DROP%20TABLE"),env({DB:fakeDb}));
  expect(res.status).toBe(200);
  expect(prepared).toContain("WHERE status = ?");
  expect(prepared).not.toContain("DROP");
  expect(args).toEqual(["published",20]);
  expect(await res.text()).toContain("\\u003c");
  expect(res.headers.get("Content-Type")).toContain("application/json");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
 });
 test("rejects invalid D1 rows and database errors without SQL disclosure",async()=>{
  const badDb={prepare(){return{bind(){return{all:async()=>({
    success:true,results:[{slug:"../private",title:"oops",excerpt:"",published_at:"now"}],
  })}}}}};
  expect((await handleFreePublicRequest(req("/__microwp/free/posts"),env({DB:badDb}))).status).toBe(503);
  const brokenDb={prepare(){throw Error("private SQL / credentials")}};
  const res=await handleFreePublicRequest(req("/__microwp/free/posts"),env({DB:brokenDb}));
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("Public index unavailable");
 });
 test("R2 fetches prefixed nonexecutable files only; HEAD never returns body",async()=>{
  const keys:string[]=[];
  const fakeR2={get:async(key:string)=>{
   keys.push(key);
   return {etag:"etag-test",size:3,body:new ReadableStream({
     start(c){c.enqueue(new Uint8Array([1,2,3]));c.close()}
   })};
  }};
  const res=await handleFreePublicRequest(req("/wp-content/uploads/2026/11/photo.jpg","HEAD"),env({MEDIA:fakeR2}));
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  expect(await res.text()).toBe("");
  expect(keys).toEqual(["wp-content/uploads/2026/11/photo.jpg"]);
  expect((await handleFreePublicRequest(req("/wp-content/uploads/secret%252ephp"),env({MEDIA:fakeR2}))).status).toBe(404);
  expect(keys.length).toBe(1);
 });
 test("R2 size over 10MB fails closed and does not leak an oversized body",async()=>{
  const e=env({MEDIA:{get:async()=>({etag:"x",size:11*1024*1024,body:null})}});
  expect((await handleFreePublicRequest(req("/wp-content/uploads/large.mp4"),e)).status).toBe(503);
 });
});
