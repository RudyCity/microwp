/**
 * Authenticated WordPress Transients API parity across PHP requests.
 * The fixed probe plugin exists only in the local Workerd test fixture.
 */
import {readFile} from "node:fs/promises";
import {join} from "node:path";

const origin=process.env.MICROWP_E2E_URL??"http://127.0.0.1:19152";
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error("Localhost-only transient test");
const file=process.env.MICROWP_E2E_AUTH_BASENAME??"wp-cache-editorial-auth.json";
if(!/^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(file))throw Error("Unsafe local auth filename");
const auth=JSON.parse(await readFile(join(".wrangler",file),"utf8")) as {sessionHeader?:string};
if(!auth.sessionHeader)throw Error("Missing local WordPress login session");

async function invoke(scope:"single"|"site",operation:"set"|"get"|"delete",value?:string,ttlSeconds?:number){
 const dashboard=await fetch(origin+"/wp-admin/",{
  headers:{Cookie:auth.sessionHeader!},signal:AbortSignal.timeout(30000)
 });
 const dashboardText=await dashboard.text();
 const index=dashboardText.indexOf("wpApiSettings");
 const nonce=index>=0?dashboardText.slice(index,index+750).match(/"nonce"\s*:\s*"([a-f0-9]{10})"/)?.[1]:null;
 if(dashboard.status!==200||!nonce)throw Error("WordPress auth/nonce prerequisite missing");
 const response=await fetch(origin+"/?rest_route=/microwp-local/v1/transient",{
  method:"POST",headers:{
   Cookie:auth.sessionHeader!,"X-WP-Nonce":nonce,"Content-Type":"application/json"
  },
  body:JSON.stringify({scope,operation,...(value?{value}:{}),
   ...(ttlSeconds?{ttlSeconds}:{})}),signal:AbortSignal.timeout(30000)
 });
 const raw=await response.text();
 let answer:Record<string,unknown>;
 try{answer=JSON.parse(raw)}catch{throw Error("Invalid WordPress transient probe response HTTP "+response.status)}
 if(response.status!==200||answer.backend!=="database")
  throw Error("WordPress transient DB parity failed: HTTP "+response.status+" / "+String(answer.backend)+" / "+String(answer.code));
 return answer;
}
const operation=process.argv[2];
if(operation==="set"){
 const unauthorized=await fetch(origin+"/?rest_route=/microwp-local/v1/transient",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({scope:"single",operation:"get"}),
  signal:AbortSignal.timeout(10000)
 });
 if(unauthorized.status!==401&&unauthorized.status!==403)
  throw Error("Transient test route must reject anonymous requests");
 console.log("PASS local WordPress transient proof requires authenticated administrator");
}
const scopes=["single","site"] as const;
for(const scope of scopes){
 if(operation==="set"){
  const result=await invoke(scope,"set","alpha",300);
  if(result.stored!==true)throw Error(scope+" transient not stored");
  console.log("PASS database-backed "+scope+" transient set in real WordPress");
 }else if(operation==="get"){
  const result=await invoke(scope,"get");
  const expected=scope==="single"?{marker:"alpha",nested:[1,2]}:"alpha";
  if(result.found!==true||JSON.stringify(result.value)!==JSON.stringify(expected))
   throw Error(scope+" transient not persistent across WordPress requests");
  console.log("PASS database-backed "+scope+" transient cross-request read");
 }else if(operation==="update"){
  const result=await invoke(scope,"set","beta",300);
  if(result.stored!==true)throw Error(scope+" transient update failed");
  console.log("PASS database-backed "+scope+" transient update");
 }else if(operation==="verify-update"){
  const result=await invoke(scope,"get");
  const expected=scope==="single"?{marker:"beta",nested:[1,2]}:"beta";
  if(result.found!==true||JSON.stringify(result.value)!==JSON.stringify(expected))
   throw Error(scope+" transient update not visible");
  console.log("PASS database-backed "+scope+" transient update across requests");
 }else if(operation==="expire-set"){
  // Change the stored value as well as its TTL; WordPress update_option()
  // may return false for an unchanged value despite updating the timeout.
  const result=await invoke(scope,"set","alpha",1);
  if(result.stored!==true)throw Error(scope+" expiration fixture not set");
  console.log("PASS "+scope+" transient short TTL set");
 }else if(operation==="missing"){
  const result=await invoke(scope,"get");
  if(result.found!==false||result.value!==null)
   throw Error(scope+" expired/deleted transient still present");
  console.log("PASS "+scope+" transient missing after delete/expiration");
 }else if(operation==="delete"){
  const result=await invoke(scope,"delete");
  if(result.deleted!==true)throw Error(scope+" transient delete failed");
  console.log("PASS "+scope+" transient delete");
 }else throw Error("Expected set|get|update|verify-update|expire-set|missing|delete");
}
