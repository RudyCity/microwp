import {describe,expect,test} from "bun:test";
import {contentTypeFor,getMedia,mediaKey,putMedia} from "../src/media";
import type {Env} from "../src/types";
describe("media bridge",()=>{
  test("safe extensions and paths",()=>{
    expect(mediaKey("/wp-content/uploads/2026/11/picture.webp")).toBe("2026/11/picture.webp");
    expect(mediaKey("/wp-content/uploads/2026/../script.jpg")).toBeNull();
    expect(mediaKey("/wp-content/uploads/file.svg")).toBeNull();
    expect(contentTypeFor("sample.pdf")).toBe("application/pdf");
  });
  test("reads private R2 object HEAD & ETag",async()=>{
    const env:Env={MEDIA:{
      async get(){return {body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("image"));c.close()}}),etag:"etag-a",size:5}},
      async put(){}
    }};
    const url="https://example.org/wp-content/uploads/2026/11/picture.png";
    const r=await getMedia(new Request(url),env,new URL(url).pathname);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(await r.text()).toBe("image");
    const head=await getMedia(new Request(url,{method:"HEAD"}),env,new URL(url).pathname);
    expect(head.body).toBeNull();
    const notModified=await getMedia(new Request(url,{headers:{"If-None-Match":"etag-a"}}),env,new URL(url).pathname);
    expect(notModified.status).toBe(304);
  });
  test("writer cannot upload scripts or oversize or invalid image signatures",async()=>{
    const written:string[]=[];
    const env:Env={MEDIA:{async get(){return null},async put(key){written.push(key)}}};
    await expect(putMedia(env,"/wp-content/uploads/bad.php",new Uint8Array())).rejects.toThrow();
    await expect(putMedia(env,"/wp-content/uploads/image.png",new Uint8Array(10*1024*1024+1))).rejects.toThrow();
    await expect(putMedia(env,"/wp-content/uploads/image.png",new Uint8Array([1,2,3]))).rejects.toThrow();
    await putMedia(env,"/wp-content/uploads/image.png",new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]));
    expect(written).toEqual(["wp-content/uploads/image.png"]);
  });
});
