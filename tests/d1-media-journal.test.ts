import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {saveD1SQLite,readD1MediaDeleteJournal,drainD1MediaDeleteJournal,type D1SqlStore} from "../src/storage/d1-sqlite";
import type {MediaR2} from "../src/types";

const KEY="wp-content/uploads/2026/11/removed.png";
const PATH="/www/"+KEY;
type Statement={sql:string;args:unknown[]};
function fixture(){
 const sql=new Database(":memory:");
 for(const file of ["0001_microwp_sqlite_snapshots.sql","0002_microwp_media_delete_journal.sql"]){
  sql.exec(readFileSync("migrations/"+file,"utf8"));
 }
 let failAt=-1;
 const d1={
  prepare(query:string){
   return {bind(...args:unknown[]){return {
    sql:query,args,
    async first(){return sql.prepare(query).get(...args as [string])??null},
    async all(){return {success:true,results:sql.prepare(query).all(...args as [string])}},
    async run(){return sql.prepare(query).run(...args as [string])}
   }}};
  },
  async batch(cmds:Statement[]){
   sql.transaction(()=>{
    for(let i=0;i<cmds.length;i++){
     if(i===failAt)throw new Error("injected D1 journal commit failure");
     sql.prepare(cmds[i].sql).run(...cmds[i].args as [string]);
    }
   })();
   return [];
  }
 };
 const deleted:string[]=[];
 let failR2=false;
 const media:MediaR2={
  async get(){return null;},
  async put(){throw new Error("media test may not upload")},
  async delete(keys){if(failR2)throw new Error("injected R2 delete failure");deleted.push(...(Array.isArray(keys)?keys:[keys]))}
 };
 return {sql,d1:d1 as unknown as D1SqlStore,media,deleted,failD1At:(i:number)=>failAt=i,failR2:(state:boolean)=>failR2=state};
}
describe("D1 crash-recoverable media deletion journal",()=>{
 test("atomically commits journal with DB image, replays after simulated crash, and is idempotent",async()=>{
  const f=fixture();
  await saveD1SQLite(f.d1,new Uint8Array([83,81,76,105,10]),undefined,[PATH,PATH]);
  expect(await readD1MediaDeleteJournal(f.d1)).toEqual([KEY]);
  // Simulate isolate termination right after the D1 transaction (no R2 cleanup yet).
  expect(f.deleted).toEqual([]);
  const recovered=await drainD1MediaDeleteJournal(f.d1,f.media);
  expect(recovered).toBe(1);
  expect(f.deleted).toEqual([KEY,KEY.slice("wp-content/uploads/".length)]);
  expect(await readD1MediaDeleteJournal(f.d1)).toEqual([]);
  expect(await drainD1MediaDeleteJournal(f.d1,f.media)).toBe(0);
 });
 test("journal insert failure rolls back the new DB image and pending delete",async()=>{
  const f=fixture();
  const old=new Uint8Array([83,81,76,105,10]);
  await saveD1SQLite(f.d1,old);
  // Second transaction: chunk insert, manifest update, old chunk cleanup, journal insert.
  f.failD1At(3);
  await expect(saveD1SQLite(f.d1,new Uint8Array([83,81,76,105,20]),undefined,[PATH])).rejects.toThrow("injected D1");
  expect(await readD1MediaDeleteJournal(f.d1)).toEqual([]);
  expect((f.sql.prepare("SELECT COUNT(*) AS n FROM microwp_db_chunks").get() as {n:number}).n).toBe(1);
  const digest=(f.sql.prepare("SELECT sha256 FROM microwp_db_snapshots").get() as {sha256:string}).sha256;
  expect(digest).toBe(await Bun.CryptoHasher.hash("sha256",old,"hex"));
 });
 test("R2 failure keeps the durable journal until a later restart",async()=>{
  const f=fixture();
  await saveD1SQLite(f.d1,new Uint8Array([83,81,76,105,1]),undefined,[PATH]);
  f.failR2(true);
  await expect(drainD1MediaDeleteJournal(f.d1,f.media)).rejects.toThrow("injected R2");
  expect(await readD1MediaDeleteJournal(f.d1)).toEqual([KEY]);
  f.failR2(false);
  expect(await drainD1MediaDeleteJournal(f.d1,f.media)).toBe(1);
  expect(await readD1MediaDeleteJournal(f.d1)).toEqual([]);
 });
 test("rejects media paths that are not validated WordPress uploads",async()=>{
  const f=fixture();
  await expect(saveD1SQLite(f.d1,new Uint8Array([1,2]),undefined,["/www/wp-content/themes/evil.php"])).rejects.toThrow("Unsafe");
  await expect(saveD1SQLite(f.d1,new Uint8Array([1,2]),undefined,["/www/wp-content/uploads/x.php"])).rejects.toThrow("Unsafe");
  expect(await readD1MediaDeleteJournal(f.d1)).toEqual([]);
 });
 test("fails closed on corrupted journal row and without R2 delete binding",async()=>{
  const f=fixture();
  await saveD1SQLite(f.d1,new Uint8Array([83,81,76,105]),undefined,[PATH]);
  await expect(drainD1MediaDeleteJournal(f.d1,undefined)).rejects.toThrow("R2 deletion binding");
  f.sql.prepare("UPDATE microwp_media_delete_journal SET object_key='wp-content/evil.php'").run();
  await expect(drainD1MediaDeleteJournal(f.d1,f.media)).rejects.toThrow("Unsafe D1 media delete");
  expect(f.deleted).toEqual([]);
 });
});
