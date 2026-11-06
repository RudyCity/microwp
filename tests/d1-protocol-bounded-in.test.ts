import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {decodeD1Request,MAX_IN_VALUES,MAX_BINDINGS} from "../src/php/d1-protocol/protocol";
import {createD1RuntimeAdapter} from "../src/php/d1-protocol/runtime-adapter";
import type {D1ProtocolPolicy} from "../src/php/d1-protocol/protocol";

const select=(whereIn:unknown)=>JSON.stringify({
 version:1,id:"in-test",op:"select",table:"wp_options",
 columns:["option_name"],whereIn,limit:50,offset:0
});

describe("private D1 structured SELECT IN predicate",()=>{
 test("accepts bounded scalar-only non-null unique IN values",()=>{
  expect(decodeD1Request(select({column:"autoload",values:["yes","on"]})))
   .toMatchObject({op:"select",whereIn:{column:"autoload",values:["yes","on"]}});
 });
 test("rejects empty, null, duplicate, too many, nested, or oversized values",()=>{
  for(const values of [[],[null],["yes","yes"],Array(MAX_IN_VALUES+1).fill("x"),
   [{sql:"DROP TABLE wp_options"}],["x".repeat(2049)],[true],[Number.NaN]]) {
   expect(()=>decodeD1Request(select({column:"autoload",values}))).toThrow();
  }
  for(const broken of [
   {column:"autoload",values:["on"],sql:"DROP TABLE wp_options"},
   {column:"site_id",values:[]},
   {column:"__proto__",values:["on"]},
   {column:"autoload",values:"on"}
  ])expect(()=>decodeD1Request(select(broken))).toThrow();
 });
 test("rejects a duplicated equality and IN column",()=>{
  const body=JSON.parse(select({column:"autoload",values:["yes"]}));
  body.where=[{column:"autoload",value:"yes"}];
  expect(()=>decodeD1Request(JSON.stringify(body))).toThrow();
 });
 test("rejects site-scope and policy-disallowed IN, without preparing SQL",async()=>{
  let count=0;
  const db={prepare(){count++;throw Error("MUST_NOT_EXECUTE")}} as unknown as D1Database;
  const policy:D1ProtocolPolicy={tables:{wp_options:{
   select:["option_name"],filter:["autoload"],
   scope:{column:"site_id",value:"site_a"}
  }}};
  const key={};
  const adapter=createD1RuntimeAdapter({db,policy,callerKey:key});
  const scopeSql=select({column:"site_id",values:["site_a"]});
  const wrongFilter=select({column:"option_value",values:["x"]});
  expect(JSON.parse(await adapter.dispatch(scopeSql,key)).error).toBe("NOT_ALLOWED");
  expect(JSON.parse(await adapter.dispatch(wrongFilter,key)).error).toBe("NOT_ALLOWED");
  expect(count).toBe(0);
 });
 test("supports exact prepared values and stable paging in real SQLite",async()=>{
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options (site_id TEXT, option_name TEXT, autoload TEXT)");
  for(let i=0;i<60;i++){
   const name="option_"+String(i).padStart(3,"0");
   sqlite.prepare("INSERT INTO wp_options VALUES (?, ?, ?)").run("site_a",name,i%2===0?"yes":"off");
   sqlite.prepare("INSERT INTO wp_options VALUES (?, ?, ?)").run("site_b",name,"yes");
  }
  const queries:Array<{sql:string;args:unknown[]}>= [];
  const db={
   prepare(sql:string){
    return {bind(...args:unknown[]){
     queries.push({sql,args});
     return {async all(){
      return {success:true,results:sqlite.prepare(sql).all(...args as (string|number|null)[])};
     }};
    }};
   }
  } as unknown as D1Database;
  const key={}, policy={tables:{wp_options:{
   select:["option_name"],filter:["autoload"],order:["option_name"],
   scope:{column:"site_id",value:"site_a"}
  }}};
  const adapter=createD1RuntimeAdapter({db,policy,callerKey:key});
  const query=JSON.parse(select({column:"autoload",values:["yes"]}));
  query.orderBy={column:"option_name",direction:"asc"};
  const first=JSON.parse(await adapter.dispatch(JSON.stringify(query),key));
  expect(first.rows).toHaveLength(30);
  expect(first.rows[0]).toEqual({option_name:"option_000"});
  expect(first.rows.at(-1)).toEqual({option_name:"option_058"});
  expect(queries[0]?.sql).toBe('SELECT "option_name" FROM "wp_options" WHERE "autoload" IN (?) AND "site_id" = ? ORDER BY "option_name" ASC LIMIT ? OFFSET ?');
  expect(queries[0]?.args).toEqual(["yes","site_a",50,0]);
  sqlite.close();
 });
 test("the most permissive valid IN plus equality predicates still fits binding budget",async()=>{
  let boundCount=0;
  const db={prepare(_sql:string){return {bind(...args:unknown[]){
   boundCount=args.length;
   return {async all(){return {success:true,results:[]}}};
  }}}} as unknown as D1Database;
  const key={};
  const policy:D1ProtocolPolicy={tables:{wp_options:{
   select:["option_name"],filter:Array.from({length:8},(_,i)=>"field_"+i).concat("autoload"),
   scope:{column:"site_id",value:"site_a"}
  }}};
  const adapter=createD1RuntimeAdapter({db,policy,callerKey:key});
  const payload=JSON.parse(select({column:"autoload",values:Array.from({length:8},(_,i)=>"v"+i)}));
  payload.where=Array.from({length:8},(_,i)=>({column:"field_"+i,value:i}));
  const result=JSON.parse(await adapter.dispatch(JSON.stringify(payload),key));
  expect(result.ok).toBe(true);
  expect(boundCount).toBe(19);
  expect(boundCount).toBeLessThanOrEqual(MAX_BINDINGS);
 });
});
