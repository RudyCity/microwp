import {describe,expect,test} from "bun:test";
import {D1_BRIDGE_READINESS_MESSAGE,handleD1BridgeReadinessMessage} from "../src/php/d1-message-bridge";

describe("private PHP-WASM-to-D1 messaging proof",()=>{
 test("fixed readiness message executes one fixed read-only query",async()=>{
  let seen="";
  const db={prepare(query:string){
   seen=query;
   return {first:async()=>({ready:1})};
  }} as unknown as D1Database;
  expect(JSON.parse(await handleD1BridgeReadinessMessage(D1_BRIDGE_READINESS_MESSAGE,db))).toEqual({ready:true});
  expect(seen).toBe("SELECT 1 AS ready");
 });
 test("unrecognized or SQL-like messages cannot execute SQL",async()=>{
  let queries=0;
  const db={prepare(_query:string){queries++;throw new Error("should not query")}} as unknown as D1Database;
  for(const input of ["SELECT * FROM wp_users",JSON.stringify({sql:"DROP TABLE wp_users"}),"","microwp:d1:readiness:v2"]){
   expect(await handleD1BridgeReadinessMessage(input,db)).toBe("");
  }
  expect(queries).toBe(0);
 });
 test("D1 failures propagate rather than pretending success",async()=>{
  const db={prepare(){return {first:async()=>{throw new Error("D1 temporarily unavailable")}}}} as unknown as D1Database;
  await expect(handleD1BridgeReadinessMessage(D1_BRIDGE_READINESS_MESSAGE,db)).rejects.toThrow("D1 temporarily unavailable");
 });
 test("false D1 response is reported as not ready",async()=>{
  const db={prepare(){return {first:async()=>({ready:0})}}} as unknown as D1Database;
  expect(JSON.parse(await handleD1BridgeReadinessMessage(D1_BRIDGE_READINESS_MESSAGE,db))).toEqual({ready:false});
 });
});
