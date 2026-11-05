import {describe,expect,test} from "bun:test";
import {digest,loadSQLiteSnapshot,saveSQLiteSnapshot,MAX_SQLITE_BYTES,SQLITE_CHUNK_BYTES,type SnapshotStore} from "../src/storage/sqlite-snapshot";
function memoryStore():SnapshotStore&{data:Map<string,unknown>} {
  const data=new Map<string,unknown>();
  const s:SnapshotStore&{data:Map<string,unknown>}={
    data,async get(k){return data.get(k)},async put(k,v){data.set(k,v)},
    async delete(k){return data.delete(k)},
    async transaction<T>(f:(tx:SnapshotStore)=>Promise<T>):Promise<T> {
      const copy=new Map(data);
      const tx:SnapshotStore={get:async k=>copy.get(k),put:async(k,v)=>{copy.set(k,v)},delete:async k=>copy.delete(k),transaction:async fn=>fn(tx)};
      const result=await f(tx);data.clear();for(const [k,v] of copy)data.set(k,v);return result;
    }
  };
  return s;
}
describe("durable sqlite snapshots",()=>{
 test("empty -> save -> load and dedupe",async()=>{
   const s=memoryStore();expect(await loadSQLiteSnapshot(s)).toBeNull();
   const bytes=new Uint8Array(SQLITE_CHUNK_BYTES*2+123);bytes.fill(37);
   expect((await saveSQLiteSnapshot(s,bytes)).changed).toBe(true);
   expect(await loadSQLiteSnapshot(s)).toEqual(bytes);
   const count=s.data.size;expect((await saveSQLiteSnapshot(s,bytes)).changed).toBe(false);
   expect(s.data.size).toBe(count);
   bytes[0]=8;
   expect((await saveSQLiteSnapshot(s,bytes)).changed).toBe(true);
   expect(s.data.size).toBe(count);
   expect(await loadSQLiteSnapshot(s)).toEqual(bytes);
 });
 test("detects corrupted data",async()=>{
   const s=memoryStore();await saveSQLiteSnapshot(s,new Uint8Array([1,2,3]));
   const key=Array.from(s.data.keys()).find(k=>k.includes("sqlite:")&&!k.endsWith("manifest"))!;
   s.data.set(key,new Uint8Array([1,5,3]));
   await expect(loadSQLiteSnapshot(s)).rejects.toThrow("SHA256 mismatch");
 });
 test("rejects database exceeding memory allowance",async()=>{
   await expect(saveSQLiteSnapshot(memoryStore(),new Uint8Array(MAX_SQLITE_BYTES+1))).rejects.toThrow("8MiB");
 });
 test("failed transaction never replaces last verified snapshot",async()=>{
   const s=memoryStore();const original=new Uint8Array([1,2,3,4,5]);
   await saveSQLiteSnapshot(s,original);
   const faulty:SnapshotStore={
     ...s,
     async transaction<T>(callback:(tx:SnapshotStore)=>Promise<T>):Promise<T>{
       return s.transaction(async tx=>{
         let written=0;
         const proxy:SnapshotStore={...tx,async put(key,value){
           await tx.put(key,value);
           if(++written===1)throw new Error("simulated write failure");
         }};
         return callback(proxy);
       });
     }
   };
   await expect(saveSQLiteSnapshot(faulty,new Uint8Array([9,8,7,6,5]))).rejects.toThrow("simulated write failure");
   expect(await loadSQLiteSnapshot(s)).toEqual(original);
 });
 test("digest is deterministic",async()=>{
   expect(await digest(new Uint8Array([1,2]))).toBe(await digest(new Uint8Array([1,2])));
 });
});
