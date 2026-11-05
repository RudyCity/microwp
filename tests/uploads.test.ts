import {describe,expect,test} from "bun:test";
import {flushUploads,hydrateUploads,finalizeUploadDeletes} from "../src/php/uploads";
import type {Env} from "../src/types";

const PNG=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
const key="2026/11/photo.png",objectKey="wp-content/uploads/"+key,filepath="/www/wp-content/uploads/"+key;
function fixture(){
 const files:Record<string,Uint8Array>={[filepath]:PNG.slice()};
 const written:string[]=[],deleted:string[]=[];
 const r2=new Map<string,Uint8Array>();
 const env:Env={MEDIA:{
  async get(k){const value=r2.get(k);return value?{body:new ReadableStream({start(c){c.enqueue(value);c.close()}}),etag:"test",size:value.length}:null;},
  async put(k,body){r2.set(k,new Uint8Array(body as Uint8Array));written.push(k);},
  async list(){return {objects:[...r2].map(([k,v])=>({key:k,size:v.length})),truncated:false}},
  async delete(k){deleted.push(k);r2.delete(k)}
 }};
 const php={
  isDir:(p:string)=>p==="/www/wp-content/uploads"||p==="/www/wp-content/uploads/2026"||p==="/www/wp-content/uploads/2026/11",
  isFile:(p:string)=>Boolean(files[p]),
  listFiles:(p:string)=>p.endsWith("/uploads")?["2026"]:p.endsWith("/2026")?["11"]:Object.keys(files).length?["photo.png"]:[],
  readFileAsBuffer:(p:string)=>files[p],
  mkdir:(_p:string)=>undefined,
  writeFile:(p:string,contents:Uint8Array)=>{files[p]=contents;}
 };
 return {php,env,written,deleted,r2,files};
}
describe("WordPress R2 write-through and cold-start rehydration",()=>{
 test("writes file, skips duplicate digest, rehydrates on new isolate",async()=>{
   const f=fixture();const old=new Map<string,string>();
   expect(await flushUploads(f.php,f.env,old)).toBe(1);
   expect(f.written).toEqual([objectKey]);
   expect(await flushUploads(f.php,f.env,old)).toBe(0);
   const next=fixture();next.r2.set(objectKey,PNG.slice());
   delete next.files[filepath];
   const replay=new Map<string,string>();
   expect(await hydrateUploads(next.php,next.env,replay)).toBe(1);
   expect(next.files[filepath]).toEqual(PNG);
   expect(await flushUploads(next.php,next.env,replay)).toBe(0);
 });
 test("remove stale object after WordPress deletes local media",async()=>{
   const f=fixture();const uploaded=new Map<string,string>();
   await flushUploads(f.php,f.env,uploaded);
   delete f.files[filepath];
   expect(await flushUploads(f.php,f.env,uploaded)).toBe(1);
   expect(f.deleted).toEqual([objectKey,key]);
   expect(f.r2.has(objectKey)).toBe(false);
 });
 test("defers destructive R2 deletes until after the DB snapshot is saved",async()=>{
   const f=fixture(),uploaded=new Map<string,string>(),pending=new Set<string>();
   await flushUploads(f.php,f.env,uploaded);
   delete f.files[filepath];
   expect(await flushUploads(f.php,f.env,uploaded,pending)).toBe(1);
   expect(pending.has(filepath)).toBe(true);
   expect(f.r2.has(objectKey)).toBe(true); // DB save has not completed; old snapshot still references R2 object
   expect(f.deleted).toEqual([]);
   expect(await finalizeUploadDeletes(f.env,uploaded,pending)).toBe(1);
   expect(f.r2.has(objectKey)).toBe(false);
   expect(pending.size).toBe(0);
 });
 test("simulated failed DB commit leaves R2 media untouched for old snapshot",async()=>{
   const f=fixture(),uploaded=new Map<string,string>(),pending=new Set<string>();
   await flushUploads(f.php,f.env,uploaded);
   delete f.files[filepath];
   await flushUploads(f.php,f.env,uploaded,pending);
   // A DB persistence failure returns 503 and never invokes finalizeUploadDeletes.
   expect(f.r2.has(objectKey)).toBe(true);
   expect(uploaded.has(filepath)).toBe(true);
   expect(pending.has(filepath)).toBe(true);
 });
 test("failed post-snapshot media delete retains its pending operation",async()=>{
   const f=fixture(),uploaded=new Map<string,string>(),pending=new Set<string>();
   await flushUploads(f.php,f.env,uploaded);
   delete f.files[filepath];
   await flushUploads(f.php,f.env,uploaded,pending);
   f.env.MEDIA!.delete=async()=>{throw new Error("simulated R2 failure")};
   await expect(finalizeUploadDeletes(f.env,uploaded,pending)).rejects.toThrow("simulated R2 failure");
   expect(pending.has(filepath)).toBe(true);
   expect(uploaded.has(filepath)).toBe(true);
 });
 test("no R2 fails closed on new upload",async()=>{
   const f=fixture();await expect(flushUploads(f.php,{},new Map())).rejects.toThrow("R2 binding required");
 });
 test("corrupt object fails closed on rehydration",async()=>{
   const f=fixture();f.r2.set(objectKey,new Uint8Array([1,2,3,4]));
   await expect(hydrateUploads(f.php,f.env,new Map())).rejects.toThrow("Corrupt R2");
 });
 test("oversized listing fails closed without downloading",async()=>{
   const f=fixture();f.env.MEDIA!.list=async()=>({objects:Array.from({length:33},(_,i)=>({key:`wp-content/uploads/${i}.png`,size:PNG.length})),truncated:true});
   await expect(hydrateUploads(f.php,f.env,new Map())).rejects.toThrow("32 files");
 });
});
