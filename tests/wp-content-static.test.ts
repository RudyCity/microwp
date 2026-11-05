import {describe,expect,test} from "bun:test";
import {staticWpContentR2Key,getR2WpContentStatic} from "../src/wp-content-static";
import type {Env} from "../src/types";

describe("R2 read-only wp-content static overlay",()=>{
 test("only safe theme and plugin static files can be looked up",()=>{
  expect(staticWpContentR2Key("/wp-content/themes/twentytwentyfive/style.css")).toBe("wp-content/themes/twentytwentyfive/style.css");
  expect(staticWpContentR2Key("/wp-content/plugins/foo/build/app.js")).toBe("wp-content/plugins/foo/build/app.js");
  expect(staticWpContentR2Key("/wp-content/plugins/foo/main.php")).toBeNull();
  expect(staticWpContentR2Key("/wp-content/themes/foo/../evil.css")).toBeNull();
  expect(staticWpContentR2Key("/wp-content/themes/foo/.env")).toBeNull();
  expect(staticWpContentR2Key("/wp-content/themes/foo/evil.svg")).toBeNull();
  expect(staticWpContentR2Key("/wp-content/uploads/image.png")).toBeNull();
 });
 test("returns R2 CSS, 304, and HEAD without reading user PHP",async()=>{
  const key="wp-content/themes/twentytwentyfive/style.css",lookups:string[]=[];
  const env:Env={MEDIA:{
   async get(path){lookups.push(path);if(path!==key)return null;
    return {etag:"the-etag",size:5,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("hello"));c.close()}})};},
   async put(){throw new Error("static overlay must never write")}
  }};
  const url="http://localhost/wp-content/themes/twentytwentyfive/style.css";
  const body=await getR2WpContentStatic(new Request(url),env,new URL(url).pathname);
  expect(body?.status).toBe(200);
  expect(body?.headers.get("Content-Type")).toBe("text/css");
  expect(await body?.text()).toBe("hello");
  expect((await getR2WpContentStatic(new Request(url,{method:"HEAD"}),env,new URL(url).pathname))?.body).toBeNull();
  const unchanged=await getR2WpContentStatic(new Request(url,{headers:{"If-None-Match":"the-etag"}}),env,new URL(url).pathname);
  expect(unchanged?.status).toBe(304);
  expect(lookups).toEqual([key,key,key]);
  expect(await getR2WpContentStatic(new Request(url),{},new URL(url).pathname)).toBeNull();
  expect(await getR2WpContentStatic(new Request("http://localhost/wp-content/plugins/a.php"),env,"/wp-content/plugins/a.php")).toBeNull();
 });
});
