/**
 * Non-destructive remote staging smoke. Works only on an explicitly supplied HTTPS URL.
 * Public dynamic site and all upload/media paths MUST be blocked in alpha staging.
 */
const supplied=process.env.MICROWP_STAGING_URL;
if(!supplied)throw new Error("Set MICROWP_STAGING_URL to a verified staging HTTPS URL");
const url=new URL(supplied);
if(url.protocol!=="https:"||["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Staging URL must be real HTTPS");
const origin=url.origin;
let failed=0;
async function check(path:string,expected:number|number[],label:string,options:RequestInit={}){
 const response=await fetch(origin+path,{redirect:"manual",signal:AbortSignal.timeout(15000),...options});
 const allowed=Array.isArray(expected)?expected:[expected];
 const ok=allowed.includes(response.status);
 console.log((ok?"PASS ":"FAIL ")+label+" — HTTP "+response.status);
 if(!ok)failed++;
 return response;
}
const health=await check("/__microwp/health",200,"Cloudflare staging health");
if(health.ok){
 const status=await health.json() as {publicReady?:boolean;storage?:string};
 if(status.publicReady!==false||status.storage!=="d1-sqlite-bridge"){
   console.log("FAIL staging safety flags are missing or incorrect");
   failed++;
 }
}
await check("/",503,"Dynamic WordPress remains blocked publicly");
await check("/wp-config.php",[403,404],"WordPress configuration never exposed");
await check("/wp-content/uploads/2026/11/preview.png",503,"Media remains blocked publicly");
await check("/wp-admin/",503,"Admin remains blocked publicly");
await check("/wp-login.php",503,"WordPress login remains blocked publicly");
await check("/wp-includes/js/jquery/jquery.min.js",503,"Static WordPress assets remain blocked publicly");
await check("/?rest_route=/wp/v2/posts",503,"REST API remains blocked publicly");
await check("/__microwp/private/php-probe",404,"Private PHP probe rejects unauthenticated GET");
await check("/__microwp/private/php-probe",404,"Private PHP probe rejects unauthenticated POST",{method:"POST",headers:{"X-MicroWP-Probe-Key":"invalid"}});
console.log("Staging smoke: "+(failed?"FAIL":"PASS"));
if(failed)process.exitCode=1;
