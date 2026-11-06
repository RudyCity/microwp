import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {translateGetOption} from "../src/php/d1-wpdb-conformance/options-get";
import {createD1RuntimeAdapter} from "../src/php/d1-protocol/runtime-adapter";

const query="SELECT option_value FROM wp_options WHERE option_name = %s LIMIT 1";

describe("experimental wpdb get_option query compatibility",()=>{
 test("emits only a bounded v1 structured SELECT with one bound option",()=>{
  expect(translateGetOption(query,"blogname","req1")).toEqual({
   version:1,id:"req1",op:"select",table:"wp_options",
   columns:["option_value"],where:[{column:"option_name",value:"blogname"}],
   limit:1,offset:0,orderBy:undefined
  });
 });
 test("rejects unsupported SQL, unexpected column and extra clauses",()=>{
  for(const unsupported of [
   "DELETE FROM wp_options WHERE option_name = %s",
   "SELECT * FROM wp_options",
   "SELECT option_value FROM wp_options WHERE option_name = %s",
   "SELECT option_value FROM wp_options WHERE option_name = %s LIMIT 2",
   "SELECT option_value FROM wp_users WHERE option_name = %s LIMIT 1",
   query+";",
   query+" -- additional condition"
  ])expect(()=>translateGetOption(unsupported,"blogname","req1")).toThrow();
  for(const option of ["","x".repeat(192),"bad\u0000key"])
   expect(()=>translateGetOption(query,option,"req1")).toThrow();
 });
 test("real SQLite-backed D1 adapter keeps site scope and binds data",async()=>{
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options(site_id TEXT,option_name TEXT,option_value TEXT)");
  sqlite.exec("INSERT INTO wp_options VALUES ('site_a','blogname','Site A'),('site_b','blogname','Site B')");
  const statements:Array<{sql:string;bindings:unknown[]}>= [];
  const db={prepare(sql:string){
   return {bind(...bindings:unknown[]){
    statements.push({sql,bindings});
    return {async all(){
     return {success:true,results:sqlite.prepare(sql).all(...bindings as (string|number|null)[])};
    }};
   }};
  }} as unknown as D1Database;
  const callerKey={caller:"trusted"};
  const adapter=createD1RuntimeAdapter({
   db,callerKey,policy:{tables:{wp_options:{
    select:["option_value"],filter:["option_name"],
    scope:{column:"site_id",value:"site_a"}
   }}}
  });
  const direct=translateGetOption(query,"blogname","req1");
  const ok=JSON.parse(await adapter.dispatch(JSON.stringify(direct),callerKey));
  expect(ok.rows).toEqual([{option_value:"Site A"}]);
  expect(statements[0]?.bindings).toEqual(["blogname","site_a",1,0]);
  const untrustedName="blogname' OR 1=1";
  const safe=translateGetOption(query,untrustedName,"req2");
  const absent=JSON.parse(await adapter.dispatch(JSON.stringify(safe),callerKey));
  expect(absent.rows).toEqual([]);
  expect(statements[1]?.sql).not.toContain(untrustedName);
  expect(statements[1]?.bindings[0]).toBe(untrustedName);
  sqlite.close();
 });
});
