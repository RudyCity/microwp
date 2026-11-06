/**
 * Fail-closed production gate. Unit passing does NOT imply a deployable production WordPress.
 * Set attestations only after real external validation by the operator.
 */
import {existsSync,readFileSync} from "node:fs";
const assertions:Array<{name:string;okay:boolean;reason:string}>=[];
const manifestPath=new URL("../generated/wordpress-manifest.json",import.meta.url);
function requireGate(name:string,okay:boolean,reason:string){assertions.push({name,okay,reason})}
function flag(name:string){return process.env[name]==="verified"}
function configured(name:string,length=10){return (process.env[name]?.length??0)>=length}
requireGate("Pinned WP 7.1.4 and SQLite 3.1.3 manifests",existsSync(manifestPath),"Run source fetch and packaging first");
if(existsSync(manifestPath)){
 const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
 requireGate("Official WordPress SHA256 pinned",manifest.official_zip_sha256==="a147146c159362778ecbbbfb07bb20ddf4e85b130f971c824e656a8f938c5f87","Checksum mismatch");
}
requireGate("Stable WordPress salts",configured("WP_SECRET_KEY",64),"Configure stable secret in Cloudflare, not Git");
requireGate("HTTPS WordPress site URL",(()=>{try{const u=new URL(process.env.WP_PUBLIC_URL??"");return u.protocol==="https:"&&u.hostname!=="localhost"}catch{return false}})(),"Operator must approve staging/production domain");
requireGate("R2 media end-to-end",flag("MICROWP_MEDIA_E2E_VERIFIED"),"Provision R2 and test WordPress upload/download/resize/rehydration");
requireGate("Database crash/restart recovery",flag("MICROWP_DB_RESTORE_VERIFIED"),"Install WordPress, restart Worker, verify persisted posts/settings");
requireGate("Cloudflare staging HTTP/admin/REST",flag("MICROWP_STAGING_VERIFIED"),"Deploy in private staging after authenticating Wrangler");
requireGate("Live memory and CPU",flag("MICROWP_LIMITS_VERIFIED"),"Measure worst-case isolate peak under 128MB and Worker CPU");
requireGate("Real WordPress bootstrap meets Cloudflare Free CPU limits",flag("MICROWP_WORDPRESS_CPU_VERIFIED"),"Verify actual ingress Worker <=10ms and SQLite Durable Object <=30s CPU for cold/warm installer, admin, REST and editorial invocations; historical 2010ms failure ran in ingress, not DO");
requireGate("Live D1/R2 Free query, subrequest and storage budgets",flag("MICROWP_FREE_STORAGE_QUOTAS_VERIFIED"),"Check actual per-invocation D1 <=50 queries plus Worker subrequest limits, D1 database <=500MB, account quotas, and bulk R2 media workloads on remote Cloudflare; local tests are insufficient");
requireGate("WordPress query-level D1 wpdb conformance and migration",flag("MICROWP_NATIVE_D1_WPDB_VERIFIED"),"All wpdb queries must execute on D1 with verified SQL semantics, transaction/DDL support, lossless reversible migration and real WordPress E2E; D1 snapshot BLOBs are insufficient");
requireGate("WordPress authentication/CSRF",flag("MICROWP_AUTH_VERIFIED"),"Login, logout, cookie, nonce, admin and restart E2E");
requireGate("Security, backups and restore",flag("MICROWP_SECURITY_VERIFIED"),"Independent security/recovery testing and backup rehearsal");
requireGate("Explicit operator production approval",flag("MICROWP_OPERATOR_GO"),"Approve domain cutover and monitoring");
for(const a of assertions)console.log((a.okay?"PASS ":"BLOCK ")+a.name+(a.okay?"":": "+a.reason));
const blocked=assertions.filter(a=>!a.okay);
console.log("Production gates passed: "+(assertions.length-blocked.length)+"/"+assertions.length);
if(blocked.length)process.exitCode=1;
