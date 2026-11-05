/**
 * Authorized diagnostic only; never sends arbitrary PHP code or WordPress requests.
 * The credential stays in ignored .wrangler/ and is only transmitted in a request header.
 */
import {readFile,writeFile} from "node:fs/promises";
import {PROBE_PATH} from "../src/staging-probe";

const endpoint=process.env.MICROWP_STAGING_URL;
if(!endpoint)throw new Error("Set MICROWP_STAGING_URL to the explicitly approved HTTPS staging endpoint");
const origin=new URL(endpoint);
if(origin.protocol!=="https:"||!origin.hostname.endsWith(".workers.dev"))throw new Error("Private probe requires workers.dev HTTPS staging");
const secret=(await readFile(".wrangler/staging-probe.key","utf8")).trim();
if(secret.length<64||secret.length>128)throw new Error("Missing strong locally generated staging probe key");
const scope=process.argv.includes("--storage-write-test")?"storage-write-test":process.argv.includes("--storage")?"storage":process.argv.includes("--wordpress")?"wordpress":"runtime";
const route=origin.origin+PROBE_PATH;
const start=performance.now();
const resp=await fetch(route,{method:"POST",headers:{"X-MicroWP-Probe-Key":secret,"X-MicroWP-Probe-Scope":scope},signal:AbortSignal.timeout(110000),redirect:"manual"});
const text=await resp.text();
if(!resp.ok){
 let diagnostic="unstructured Cloudflare response";
 try {const parsed=JSON.parse(text) as {error?:string};if(parsed.error&&/^[A-Z_]{4,64}$/.test(parsed.error))diagnostic=parsed.error;}catch{}
 console.error("Private PHP probe HTTP "+resp.status+"; diagnostic="+diagnostic+"; content-type="+(resp.headers.get("content-type")??"none"));
 process.exitCode=1;
}else{
 const result=JSON.parse(text) as {ok?:boolean;phpVersion?:string;sqlite?:boolean;installerStatus?:number;installerForm?:boolean;runtimeInitMs?:number;requestMs?:number;stats?:{loadedFiles?:number;loadedBytes?:number}};
 const report={at:new Date().toISOString(),endpoint:origin.origin,httpStatus:resp.status,requestRoundTripMs:Math.round(performance.now()-start),...result};
 await writeFile(".wrangler/staging-private-probe-result.json",JSON.stringify(report,null,2)+"\n");
 console.log("Cloudflare private canary:",JSON.stringify(report,null,2));
 if(scope==="storage-write-test"){
  if(!result.ok||(result as any).backend!=="d1-batch-blob"||(result as any).verified!==true)process.exitCode=1;
 }else if(scope==="storage"){
  if(!result.ok||(result as any).backend!=="d1-sqlite-bridge"||(result as any).r2Available!==true)process.exitCode=1;
 }else if(!result.ok||!result.sqlite||result.phpVersion!=="8.4.27"||(scope==="wordpress"&&(!result.installerForm||result.installerStatus!==200)))process.exitCode=1;
}
