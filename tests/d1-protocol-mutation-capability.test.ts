import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {createD1RuntimeAdapter} from "../src/php/d1-protocol/runtime-adapter";
import {handleD1ProtocolMessage} from "../src/php/d1-protocol/worker";
import type {D1ProtocolPolicy} from "../src/php/d1-protocol/protocol";
import {readFileSync} from "node:fs";

const request=(op:object)=>JSON.stringify({version:1,id:"test-write",...op});
const update=(where:unknown=[{column:"id",value:1}],values:unknown={title:"updated"})=>
 request({op:"update",table:"posts",values,where});
const remove=(where:unknown=[{column:"id",value:1}])=>
 request({op:"delete",table:"posts",where});
const insert=request({op:"insert",table:"posts",values:{id:3,title:"created"}});

function fixture(){
 const sqlite=new Database(":memory:");
 sqlite.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, site_id TEXT NOT NULL, title TEXT NOT NULL)");
 sqlite.exec("INSERT INTO posts (id,site_id,title) VALUES (1,'tenant-A','before'),(2,'tenant-B','secret')");
 const compiled:Array<{sql:string;args:unknown[]}>=[], counters={calls:0};
 const db={
  prepare(sql:string){
   counters.calls++;
   return {bind(...args:unknown[]){
    compiled.push({sql,args});
    return {
     async all(){return {success:true,results:sqlite.prepare(sql).all(...args as (string|number|null)[])}},
     async run(){
      const result=sqlite.prepare(sql).run(...args as (string|number|null)[]);
      return {success:true,meta:{changes:result.changes}};
     }
    };
   }};
  }
 } as unknown as D1Database;
 const policy:D1ProtocolPolicy={tables:{posts:{
  select:["id","title"],insert:["id","title"],update:["title"],
  delete:true,identityColumn:"id",filter:["id"],scope:{column:"site_id",value:"tenant-A"}
 }}};
 const callerKey=Object.freeze({caller:true});
 const writeCapabilities={insert:Object.freeze({op:"insert"}),update:Object.freeze({op:"update"}),delete:Object.freeze({op:"delete"})};
 const adapter=createD1RuntimeAdapter({db,policy,callerKey,writeCapabilities});
 const stored=()=>sqlite.prepare("SELECT id,site_id,title FROM posts ORDER BY id").all();
 return {sqlite,db,policy,callerKey,writeCapabilities,adapter,compiled,counters,stored};
}
const result=async(value:Promise<string>)=>JSON.parse(await value) as Record<string,unknown>;

describe("experimental private WordPress D1 bounded mutation capability",()=>{
 test("default adapter denies all mutations even with a valid read caller key",async()=>{
  const f=fixture();
  const readOnly=createD1RuntimeAdapter({db:f.db,policy:f.policy,callerKey:f.callerKey});
  for(const payload of [insert,update(),remove()]){
   const answer=await result(readOnly.dispatch(payload,f.callerKey));
   expect(answer.error).toBe("NOT_ALLOWED");
  }
  expect(f.counters.calls).toBe(0);
  f.sqlite.close();
 });
 test("independent write object identities are mandatory and cannot be crossed",async()=>{
  const f=fixture();
  for(const [payload,wrong] of [
   [insert,f.writeCapabilities.update],
   [update(),f.writeCapabilities.delete],
   [remove(),f.writeCapabilities.insert],
   [remove(),Object.freeze({op:"delete"})],
  ] as const){
   expect((await result(f.adapter.dispatch(payload,f.callerKey,wrong))).error).toBe("NOT_ALLOWED");
  }
  expect((await result(f.adapter.dispatch(update(),{} as object,f.writeCapabilities.update))).error).toBe("NOT_ALLOWED");
  expect(f.counters.calls).toBe(0);
  f.sqlite.close();
 });
 test("prepared UPDATE/DELETE cannot escape the trusted site scope",async()=>{
  const f=fixture();
  const a=await result(f.adapter.dispatch(update(),f.callerKey,f.writeCapabilities.update));
  expect(a).toEqual({version:1,id:"test-write",ok:true,op:"update",changes:1});
  expect(f.compiled[0]).toEqual({
   sql:'UPDATE "posts" SET "title" = ? WHERE "id" = ? AND "site_id" = ?',
   args:["updated",1,"tenant-A"]
  });
  const wrongSite=await result(f.adapter.dispatch(remove([{column:"id",value:2}]),f.callerKey,f.writeCapabilities.delete));
  expect(wrongSite.changes).toBe(0);
  expect(f.stored()).toEqual([{id:1,site_id:"tenant-A",title:"updated"},{id:2,site_id:"tenant-B",title:"secret"}]);
  const b=await result(f.adapter.dispatch(remove(),f.callerKey,f.writeCapabilities.delete));
  expect(b).toEqual({version:1,id:"test-write",ok:true,op:"delete",changes:1});
  expect(f.compiled[2]).toEqual({
   sql:'DELETE FROM "posts" WHERE "id" = ? AND "site_id" = ?',
   args:[1,"tenant-A"]
  });
  expect(f.stored()).toEqual([{id:2,site_id:"tenant-B",title:"secret"}]);
  f.sqlite.close();
 });
 test("SQL injection values remain bound data for UPDATE",async()=>{
  const f=fixture(), injection="x'); DELETE FROM posts; --";
  const out=await result(f.adapter.dispatch(update([{column:"id",value:1}],{title:injection}),f.callerKey,f.writeCapabilities.update));
  expect(out.ok).toBe(true);
  expect(f.compiled[0]?.sql).not.toContain(injection);
  expect(f.compiled[0]?.args[0]).toBe(injection);
  expect(f.stored()).toHaveLength(2);
  f.sqlite.close();
 });
 test("bulk/malformed/unsafe mutations fail before D1 prepare()",async()=>{
  const f=fixture();
  const forbidden=[
   update([]),remove([]),update([{column:"title",value:"before"}]),
   remove([{column:"title",value:"before"}]),update([{column:"id",value:null}]),
   remove([{column:"id",value:null}]),update([{column:"id",value:1}],{site_id:"tenant-B"}),
   update([{column:"id",value:1}],{id:2}),
   update([{column:"site_id",value:"tenant-B"},{column:"id",value:1}]),
   remove([{column:"site_id",value:"tenant-A"},{column:"id",value:1}]),
   update([{column:"id",value:1}],{}),
   request({op:"delete",table:"posts",where:[{column:"id",value:1}],sql:"DROP TABLE posts"}),
   request({op:"update",table:"posts",where:[{column:"id",value:1}],values:{title:"x"},orderBy:{column:"id",direction:"asc"}}),
   request({op:"delete",table:"sqlite_master",where:[{column:"id",value:1}]}),
   request({op:"delete",table:"posts",where:[{column:"id",value:1},{column:"id",value:2}]}),
  ];
  for(const wire of forbidden){
   const key=wire.includes('"op":"delete"')?f.writeCapabilities.delete:f.writeCapabilities.update;
   expect((await result(f.adapter.dispatch(wire,f.callerKey,key))).ok).toBe(false);
  }
  expect(f.counters.calls).toBe(0);
  f.sqlite.close();
 });
 test("mutations stay disabled by policy and cannot be enabled after policy snapshot",async()=>{
  const f=fixture();
  const source:D1ProtocolPolicy={tables:{posts:{select:["id"],filter:["id"],scope:{column:"site_id",value:"tenant-A"}}}};
  const adapter=createD1RuntimeAdapter({db:f.db,policy:source,callerKey:f.callerKey,writeCapabilities:f.writeCapabilities});
  (source.tables as Record<string,any>).posts={
   update:["title"],delete:true,identityColumn:"id",filter:["id"],scope:{column:"site_id",value:"tenant-B"}
  };
  expect((await result(adapter.dispatch(update(),f.callerKey,f.writeCapabilities.update))).error).toBe("NOT_ALLOWED");
  expect((await result(adapter.dispatch(remove(),f.callerKey,f.writeCapabilities.delete))).error).toBe("NOT_ALLOWED");
  expect(f.counters.calls).toBe(0);
  f.sqlite.close();
 });
 test("invalid mutation policies and non-independent keys fail at initialization",()=>{
  const f=fixture();
  const base={db:f.db,callerKey:f.callerKey};
  for(const rule of [
   {update:["title"],filter:["id"],scope:{column:"site_id",value:"tenant-A"}},
   {delete:true,filter:["id"],scope:{column:"site_id",value:"tenant-A"}},
   {update:["site_id"],identityColumn:"id",filter:["id"],scope:{column:"site_id",value:"tenant-A"}},
   {update:["id"],identityColumn:"id",filter:["id"],scope:{column:"site_id",value:"tenant-A"}},
  ]){
   expect(()=>createD1RuntimeAdapter({...base,policy:{tables:{posts:rule}}})).toThrow();
  }
  expect(()=>createD1RuntimeAdapter({...base,policy:f.policy,writeCapabilities:{
   update:f.callerKey
  }})).toThrow();
  expect(()=>createD1RuntimeAdapter({...base,policy:f.policy,writeCapabilities:{
   update:f.writeCapabilities.update,delete:f.writeCapabilities.update
  }})).toThrow();
  f.sqlite.close();
 });
 test("direct internal handler requires a separate destructive authorization even for permissive policy",async()=>{
  const f=fixture();
  const blockedUpdate=await result(handleD1ProtocolMessage(update(),f.db,f.policy));
  const blockedDelete=await result(handleD1ProtocolMessage(remove(),f.db,f.policy));
  expect(blockedUpdate.error).toBe("NOT_ALLOWED");
  expect(blockedDelete.error).toBe("NOT_ALLOWED");
  expect(f.counters.calls).toBe(0);
  const permitted=await result(handleD1ProtocolMessage(update(),f.db,f.policy,"update"));
  expect(permitted.changes).toBe(1);
  f.sqlite.close();
 });
 test("raw handler remains internal and wpdb PHP drop-in remains explicitly read-only",async()=>{
  const f=fixture();
  // Host-only direct handler has no public fetch route; policy stays trusted.
  const direct=await result(handleD1ProtocolMessage(update(),f.db,{tables:{
   posts:{select:["id"],scope:{column:"site_id",value:"tenant-A"},filter:["id"]}
  }}));
  expect(direct.error).toBe("NOT_ALLOWED");
  const php=readFileSync("src/php/d1-wpdb/db.php","utf8");
  expect(php).toContain("MICRO_WP_D1_READONLY_PROOF");
  expect(php).not.toContain("MicroWpD1ReadWriteWpdb");
  f.sqlite.close();
 });
});
