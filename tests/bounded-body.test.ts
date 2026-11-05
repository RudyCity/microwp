import {describe,expect,test} from "bun:test";
import {readBoundedRequestBody,MAX_PHP_REQUEST_BODY_BYTES} from "../src/php/bounded-body";

const url="https://localhost/wp-json/wp/v2/media";
function streamRequest(parts:number[],lengthHeader?:string,onCancel?:()=>void){
 let next=0;
 const stream=new ReadableStream<Uint8Array>({
  pull(controller){
   if(next>=parts.length){controller.close();return;}
   controller.enqueue(new Uint8Array(parts[next++]!));
  },
  cancel(){onCancel?.()}
 });
 const headers=lengthHeader===undefined?undefined:{"Content-Length":lengthHeader};
 return new Request(url,{method:"POST",body:stream,headers,duplex:"half"} as RequestInit);
}
describe("bounded PHP request-body reader",()=>{
 test("accepts an exact-limit chunked request with no Content-Length",async()=>{
  const body=await readBoundedRequestBody(streamRequest([524288,524288]));
  expect(body?.byteLength).toBe(MAX_PHP_REQUEST_BODY_BYTES);
 });
 test("does not retain or read the rest of an unbounded streaming request",async()=>{
  let cancelled=false;
  const body=await readBoundedRequestBody(streamRequest([MAX_PHP_REQUEST_BODY_BYTES,1,12345],undefined,()=>{cancelled=true;}));
  expect(body).toBeNull();
  expect(cancelled).toBe(true);
 });
 test("rejects Content-Length above limit or malformed before reading",async()=>{
  for(const length of ["1048577","999999999999999999999999","bad","-1","+10","1e20"]){
   expect(await readBoundedRequestBody(streamRequest([5],length))).toBeNull();
  }
 });
 test("cannot bypass limit with falsely declared short Content-Length",async()=>{
  expect(await readBoundedRequestBody(streamRequest([MAX_PHP_REQUEST_BODY_BYTES-3,4],"1"))).toBeNull();
 });
 test("returns exact concatenated body and accepts empty body",async()=>{
  const request=new Request(url,{method:"POST",body:new Uint8Array([1,2,3,4])});
  expect(await readBoundedRequestBody(request)).toEqual(new Uint8Array([1,2,3,4]));
  expect(await readBoundedRequestBody(new Request(url,{method:"GET"}))).toEqual(new Uint8Array());
 });
 test("rejects unsafe declared budget",async()=>{
  await expect(readBoundedRequestBody(new Request(url),MAX_PHP_REQUEST_BODY_BYTES+1)).rejects.toThrow("Invalid");
 });
});
