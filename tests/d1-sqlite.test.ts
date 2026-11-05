import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {loadD1SQLite,saveD1SQLite,type D1SqlStore} from "../src/storage/d1-sqlite";
import {SQLITE_CHUNK_BYTES,MAX_SQLITE_BYTES} from "../src/storage/sqlite-snapshot";

type Cmd={sql:string;args:(string|number|Uint8Array)[]};
function fixture(){
 const sql=new Database(":memory:");
 sql.exec(readFileSync("migrations/0001_microwp_sqlite_snapshots.sql","utf8"));
 let failOnBatch=-1;
 const d1={
  prepare(query:string){
   return {
    bind(...params:(string|number|Uint8Array)[]){
     return {
      sql:query,args:params,
      async first(){return sql.prepare(query).get(...params)??null},
      async all(){return {success:true,results:sql.prepare(query).all(...params)}},
      async run(){return sql.prepare(query).run(...params)}
     };
    }
   };
  },
  async batch(statements:Cmd[]){
   sql.transaction(()=>{
    for(let i=0;i<statements.length;i++){
     if(i===failOnBatch)throw new Error("simulated D1 transaction interruption");
     sql.prepare(statements[i].sql).run(...statements[i].args);
    }
   })();
   return [];
  }
 };
 return {sql,d1:d1 as unknown as D1SqlStore,failAt:(index:number)=>{failOnBatch=index}};
}
describe("D1 durable SQLite bridge",()=>{
 test("empty D1 is an uninstalled WordPress database",async()=>{
  const f=fixture();expect(await loadD1SQLite(f.d1)).toBeNull();
 });
 test("D1 stores exact bytes across multiple BLOB chunks, deduplicates, and updates",async()=>{
  const f=fixture(),bytes=new Uint8Array(SQLITE_CHUNK_BYTES*2+123);
  bytes.fill(75);bytes[0]=83;bytes[1]=81;bytes[2]=76;bytes[3]=105;
  expect((await saveD1SQLite(f.d1,bytes)).changed).toBe(true);
  expect(await loadD1SQLite(f.d1)).toEqual(bytes);
  const priorCount=(f.sql.prepare("SELECT COUNT(*) AS n FROM microwp_db_chunks").get() as {n:number}).n;
  expect(priorCount).toBe(3);
  expect((await saveD1SQLite(f.d1,bytes)).changed).toBe(false);
  bytes[10]=92;
  expect((await saveD1SQLite(f.d1,bytes)).changed).toBe(true);
  expect(await loadD1SQLite(f.d1)).toEqual(bytes);
  expect((f.sql.prepare("SELECT COUNT(*) AS n FROM microwp_db_chunks").get() as {n:number}).n).toBe(priorCount);
 });
 test("batch failure cannot replace previously verified WordPress database",async()=>{
  const f=fixture(),old=new Uint8Array([83,81,76,105,1,2,3]);
  await saveD1SQLite(f.d1,old);
  f.failAt(1);
  await expect(saveD1SQLite(f.d1,new Uint8Array([83,81,76,105,7,8,9]))).rejects.toThrow("simulated D1 transaction interruption");
  expect(await loadD1SQLite(f.d1)).toEqual(old);
 });
 test("D1 corrupted or missing chunks fail closed",async()=>{
  const f=fixture();await saveD1SQLite(f.d1,new Uint8Array([83,81,76,105,1]));
  f.sql.exec("UPDATE microwp_db_chunks SET payload = x'0001'");
  await expect(loadD1SQLite(f.d1)).rejects.toThrow("Incorrect D1 SQLite chunk size");
 });
 test("invalid manifest and unsafe site names fail closed",async()=>{
  const f=fixture();await expect(loadD1SQLite(f.d1,"../another-site")).rejects.toThrow("Unsafe D1 site ID");
  await expect(saveD1SQLite(f.d1,new Uint8Array(MAX_SQLITE_BYTES+1))).rejects.toThrow("8MiB");
 });
 test("different sites cannot read or overwrite each other's database",async()=>{
  const f=fixture();
  await saveD1SQLite(f.d1,new Uint8Array([1,2,3]),"site:alpha");
  await saveD1SQLite(f.d1,new Uint8Array([4,5,6]),"site:beta");
  expect(await loadD1SQLite(f.d1,"site:alpha")).toEqual(new Uint8Array([1,2,3]));
  expect(await loadD1SQLite(f.d1,"site:beta")).toEqual(new Uint8Array([4,5,6]));
 });
});
