import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {
 D1_FREE_QUERY_LIMIT,D1_MAX_BINDS_PER_STATEMENT,
 saveD1SQLite,loadD1SQLite,readD1MediaDeleteJournal,drainD1MediaDeleteJournal,
 type D1SqlStore
} from "../src/storage/d1-sqlite";
import {MAX_SQLITE_BYTES,SQLITE_CHUNK_BYTES} from "../src/storage/sqlite-snapshot";
import type {MediaR2} from "../src/types";

interface Statement {sql:string;args:unknown[]}
function fixture(){
 const sqlite=new Database(":memory:");
 sqlite.exec(readFileSync("migrations/0001_microwp_sqlite_snapshots.sql","utf8"));
 sqlite.exec(readFileSync("migrations/0002_microwp_media_delete_journal.sql","utf8"));
 const batches:Statement[][]=[];
 let failIndex=-1;
 let allCalls=0;
 const db={
  prepare(sql:string){
   allCalls++;
   return {bind(...args:unknown[]){
    return {
     sql,args,
     async first(){return sqlite.prepare(sql).get(...args as (string|number|null)[])??null},
     async all(){return {success:true,results:sqlite.prepare(sql).all(...args as (string|number|null)[])}},
     async run(){return sqlite.prepare(sql).run(...args as (string|number|null)[])}
    };
   }};
  },
  async batch(statements:Statement[]){
   batches.push(statements);
   sqlite.transaction(()=>{
    for(const [index,statement] of statements.entries()){
     if(index===failIndex)throw Error("injected D1 atomic commit failure");
     sqlite.prepare(statement.sql).run(...statement.args as (string|number|null)[]);
    }
   })();
   return [];
  }
 };
 return {
  sqlite,db:db as unknown as D1SqlStore,batches,
  get allCalls(){return allCalls},failBatchAt:(index:number)=>{failIndex=index}
 };
}
const mediaPaths=Array.from({length:32},(_,index)=>
 "/www/wp-content/uploads/2026/11/production-test-"+String(index)+".png"
);

describe("microWP D1 Free query and binding budgets",()=>{
 test("8MiB snapshot and 32 media deletions fit one atomic Free-plan batch",async()=>{
  const f=fixture();
  const original=new Uint8Array(MAX_SQLITE_BYTES);
  original.fill(83);
  const result=await saveD1SQLite(f.db,original,undefined,mediaPaths);
  expect(result.changed).toBe(true);
  expect(f.batches).toHaveLength(1);
  expect(f.batches[0]).toHaveLength(34);
  expect(f.batches[0].length+1).toBeLessThanOrEqual(D1_FREE_QUERY_LIMIT);
  const journal=f.batches[0].at(-1)!;
  expect(journal.sql).toStartWith("INSERT OR IGNORE INTO microwp_media_delete_journal");
  expect(journal.sql.split("(?,?)").length-1).toBe(32);
  expect(journal.args).toHaveLength(64);
  expect(journal.args.length).toBeLessThanOrEqual(D1_MAX_BINDS_PER_STATEMENT);
  expect(await readD1MediaDeleteJournal(f.db)).toHaveLength(32);
  expect(await loadD1SQLite(f.db)).toEqual(original);
  f.sqlite.close();
 });
 test("full 8MiB commit and 32 media cleanups use fewer than 50 D1 queries and 3 R2 calls",async()=>{
  const f=fixture();
  const dbCallsBefore=f.allCalls;
  const payload=new Uint8Array(MAX_SQLITE_BYTES).fill(55);
  await saveD1SQLite(f.db,payload,undefined,mediaPaths);
  let r2Calls=0;
  const media={async delete(keys:string|string[]){
   r2Calls++;
   expect(Array.isArray(keys)).toBe(true);
   expect(keys).toHaveLength(32);
  }} as MediaR2;
  expect(await drainD1MediaDeleteJournal(f.db,media)).toBe(32);
  const totalD1Queries=f.allCalls-dbCallsBefore;
  expect(totalD1Queries).toBe(37);
  expect(totalD1Queries).toBeLessThanOrEqual(D1_FREE_QUERY_LIMIT);
  expect(r2Calls).toBe(2);
  expect(totalD1Queries+r2Calls).toBeLessThanOrEqual(50);
  f.sqlite.close();
 });
 test("replacing an 8MiB image and journaling 32 deletes also stays within Free limits",async()=>{
  const f=fixture();
  const original=new Uint8Array(MAX_SQLITE_BYTES).fill(77);
  await saveD1SQLite(f.db,original);
  const next=original.slice();
  next[123]=88;
  await saveD1SQLite(f.db,next,undefined,mediaPaths);
  expect(f.batches[1]).toHaveLength(35);
  expect(f.batches[1].length+1).toBeLessThanOrEqual(D1_FREE_QUERY_LIMIT);
  expect(await loadD1SQLite(f.db)).toEqual(next);
  expect(await readD1MediaDeleteJournal(f.db)).toHaveLength(32);
  const active=f.sqlite.prepare("SELECT revision FROM microwp_db_snapshots").get() as {revision:string};
  expect((f.sqlite.prepare("SELECT COUNT(DISTINCT revision) AS n FROM microwp_db_chunks").get() as {n:number}).n).toBe(1);
  expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM microwp_db_chunks WHERE revision=?").get(active.revision) as {n:number}).n)
   .toBe(Math.ceil(MAX_SQLITE_BYTES/SQLITE_CHUNK_BYTES));
  f.sqlite.close();
 });
 test("injected D1 failure rolls back snapshot AND bulk media journal",async()=>{
  const f=fixture();
  const original=new Uint8Array(SQLITE_CHUNK_BYTES+1).fill(91);
  await saveD1SQLite(f.db,original);
  const next=original.slice();
  next[50]=92;
  f.failBatchAt(4);
  await expect(saveD1SQLite(f.db,next,undefined,mediaPaths))
   .rejects.toThrow("injected D1 atomic commit failure");
  expect(await loadD1SQLite(f.db)).toEqual(original);
  expect(await readD1MediaDeleteJournal(f.db)).toEqual([]);
  f.sqlite.close();
 });
 test("acknowledges 32 successfully removed media in one bounded D1 statement",async()=>{
  const f=fixture();
  await saveD1SQLite(f.db,new Uint8Array([83,81,76,105,1]),undefined,mediaPaths);
  const keys:string[]=[];
  const batches:string[][]=[];
  const media={async delete(items:string|string[]){
   const group=Array.isArray(items)?items:[items];
   batches.push(group);
   keys.push(...group);
  }} as MediaR2;
  const before=f.allCalls;
  expect(await drainD1MediaDeleteJournal(f.db,media)).toBe(32);
  expect(f.allCalls-before).toBe(2); // One journal SELECT + one bulk DELETE.
  expect(batches).toHaveLength(2); // Only two R2 subrequests for 64 keys.
  expect(batches[0]).toHaveLength(32);
  expect(batches[1]).toHaveLength(32);
  expect(keys).toHaveLength(64); // Both canonical and legacy-prefix objects.
  expect(await readD1MediaDeleteJournal(f.db)).toEqual([]);
  f.sqlite.close();
 });
 test("partial R2 failure retains every journal entry for safe retry",async()=>{
  const f=fixture();
  await saveD1SQLite(f.db,new Uint8Array([83,81,76,105,2]),undefined,mediaPaths);
  let attempts=0;
  const broken={async delete(){if(++attempts===2)throw Error("injected R2 failure")}} as unknown as MediaR2;
  await expect(drainD1MediaDeleteJournal(f.db,broken)).rejects.toThrow("injected R2 failure");
  expect(await readD1MediaDeleteJournal(f.db)).toHaveLength(32);
  f.sqlite.close();
 });
 test("invalid media path or exceeding 32 deletes fails without any D1 batch",async()=>{
  const f=fixture();
  await expect(saveD1SQLite(f.db,new Uint8Array([83,81]),undefined,
    [...mediaPaths,"/www/wp-content/uploads/2026/11/extra.png"])).rejects.toThrow();
  await expect(saveD1SQLite(f.db,new Uint8Array([83,81]),undefined,
    ["/www/wp-content/themes/evil.php"])).rejects.toThrow();
  expect(f.batches).toHaveLength(0);
  f.sqlite.close();
 });
});
