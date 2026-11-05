import {describe,expect,test} from "bun:test";
import {flushUploads} from "../src/php/uploads";
import type {Env} from "../src/types";
function fixture() {
 const paths:Record<string,Uint8Array>={
   "/www/wp-content/uploads/2026/11/photo.png":new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4])
 };
 const uploaded:string[]=[];
 const php={
   isDir:(p:string)=>p==="/www/wp-content/uploads"||p==="/www/wp-content/uploads/2026"||p==="/www/wp-content/uploads/2026/11",
   isFile:(p:string)=>Boolean(paths[p]),
   listFiles:(p:string)=>p.endsWith("/uploads")?["2026"]:p.endsWith("/2026")?["11"]:["photo.png"],
   readFileAsBuffer:(p:string)=>paths[p]
 };
 const env:Env={MEDIA:{async get(){return null},async put(key){uploaded.push(key)}}};
 return {php,env,uploaded};
}
describe("WP uploads write-through",()=>{
 test("uploads to R2 and skips unchanged files",async()=>{
   const f=fixture();const journal=new Map<string,string>();
   expect(await flushUploads(f.php,f.env,journal)).toBe(1);
   expect(f.uploaded).toEqual(["2026/11/photo.png"]);
   expect(await flushUploads(f.php,f.env,journal)).toBe(0);
 });
 test("no R2 fails closed",async()=>{
   const f=fixture();await expect(flushUploads(f.php,{},new Map())).rejects.toThrow("R2 binding required");
 });
});
