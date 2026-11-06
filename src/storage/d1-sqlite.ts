/**
 * D1 durable storage for the PHP-WASM SQLite file.
 *
 * D1 is the durable source of truth. The SQLite plugin still runs PDO against
 * an ephemeral file in the PHP-WASM filesystem. This adapter stores that
 * file as bounded BLOB chunks in D1 transactions. This is NOT direct WordPress
 * SQL dispatch to D1. Do not confuse a bridge with a native D1 wpdb driver.
 */
import {digest,MAX_SQLITE_BYTES,SQLITE_CHUNK_BYTES} from "./sqlite-snapshot";
import {r2MediaKey,R2_UPLOADS_PREFIX} from "../media";
import type {MediaR2} from "../types";

export type D1SqlStore = Pick<D1Database,"prepare"|"batch">;
export const DEFAULT_SITE_ID="microwp:single-site:v1";
const MAX_PARTS=Math.ceil(MAX_SQLITE_BYTES/SQLITE_CHUNK_BYTES);
/** The Free plan permits 50 D1 queries per Worker invocation. */
export const D1_FREE_QUERY_LIMIT=50;
/** D1 also limits bound parameters per individual SQL statement to 100. */
export const D1_MAX_BINDS_PER_STATEMENT=100;
interface ManifestRow {revision:string;bytes:number;sha256:string;parts:number}
interface PartRow {part:number;payload:number[]|Uint8Array|ArrayBuffer}
export interface D1SnapshotResult {changed:boolean;sha256:string}

function safeSite(siteId:string):string{
 if(!/^[a-zA-Z0-9:_-]{1,90}$/.test(siteId))throw new Error("Unsafe D1 site ID");
 return siteId;
}
function validManifest(m:ManifestRow):boolean{
 return !!m&&typeof m.revision==="string"&&/^[0-9a-f-]{36}$/.test(m.revision)&&
  Number.isInteger(m.bytes)&&m.bytes>0&&m.bytes<=MAX_SQLITE_BYTES&&
  Number.isInteger(m.parts)&&m.parts===Math.ceil(m.bytes/SQLITE_CHUNK_BYTES)&&m.parts<=MAX_PARTS&&
  typeof m.sha256==="string"&&/^[a-f0-9]{64}$/.test(m.sha256);
}
function bytesFromD1(raw:unknown):Uint8Array{
 if(raw instanceof Uint8Array)return raw;
 if(raw instanceof ArrayBuffer)return new Uint8Array(raw);
 if(Array.isArray(raw)&&raw.length<=SQLITE_CHUNK_BYTES&&raw.every(x=>Number.isInteger(x)&&x>=0&&x<=255))return Uint8Array.from(raw);
 throw new Error("Corrupt D1 SQLite chunk BLOB");
}
export async function loadD1SQLite(db:D1SqlStore,siteId=DEFAULT_SITE_ID):Promise<Uint8Array|null>{
 const site=safeSite(siteId);
 const manifest=await db.prepare("SELECT revision,bytes,sha256,parts FROM microwp_db_snapshots WHERE site_id=?").bind(site).first<ManifestRow>();
 if(manifest===null)return null;
 if(!validManifest(manifest))throw new Error("Invalid D1 SQLite manifest");
 const response=await db.prepare("SELECT part,payload FROM microwp_db_chunks WHERE site_id=? AND revision=? ORDER BY part ASC").bind(site,manifest.revision).all<PartRow>();
 if(!response.success||response.results.length!==manifest.parts)throw new Error("Missing D1 SQLite snapshot chunks");
 const bytes=new Uint8Array(manifest.bytes);
 let offset=0;
 for(let i=0;i<response.results.length;i++){
  const row=response.results[i];
  if(row.part!==i)throw new Error("Noncontiguous D1 SQLite chunk");
  const chunk=bytesFromD1(row.payload);
  const expected=Math.min(SQLITE_CHUNK_BYTES,bytes.length-offset);
  if(chunk.length!==expected)throw new Error("Incorrect D1 SQLite chunk size");
  bytes.set(chunk,offset);offset+=chunk.length;
 }
 if(offset!==bytes.length||await digest(bytes)!==manifest.sha256)throw new Error("D1 SQLite snapshot SHA256 mismatch");
 return bytes;
}
export async function saveD1SQLite(db:D1SqlStore,sqlite:Uint8Array,siteId=DEFAULT_SITE_ID,pendingMediaPaths:readonly string[]=[]):Promise<D1SnapshotResult>{
 const site=safeSite(siteId);
 if(sqlite.length===0||sqlite.length>MAX_SQLITE_BYTES)throw new Error("SQLite snapshot exceeds 8MiB limit");
 const sha=await digest(sqlite);
 const deletes=normalizePendingMediaPaths(pendingMediaPaths);
 const prior=await db.prepare("SELECT revision,bytes,sha256,parts FROM microwp_db_snapshots WHERE site_id=?").bind(site).first<ManifestRow>();
 if(prior!==null&&!validManifest(prior))throw new Error("Invalid existing D1 SQLite manifest");
 const changed=!prior||prior.sha256!==sha||prior.bytes!==sqlite.length;
 if(!changed&&deletes.length===0)return {changed:false,sha256:sha};
 const revision=crypto.randomUUID();
 const parts=Math.ceil(sqlite.length/SQLITE_CHUNK_BYTES);
 const commands=[];
 if(changed)for(let i=0;i<parts;i++){
  const begin=i*SQLITE_CHUNK_BYTES;
  const slice=sqlite.slice(begin,Math.min(begin+SQLITE_CHUNK_BYTES,sqlite.length));
  commands.push(db.prepare("INSERT INTO microwp_db_chunks(site_id,revision,part,payload) VALUES(?,?,?,?)").bind(site,revision,i,slice));
 }
 if(changed){
  commands.push(db.prepare("INSERT INTO microwp_db_snapshots(site_id,revision,bytes,sha256,parts) VALUES(?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,bytes=excluded.bytes,sha256=excluded.sha256,parts=excluded.parts").bind(site,revision,sqlite.length,sha,parts));
  if(prior)commands.push(db.prepare("DELETE FROM microwp_db_chunks WHERE site_id=? AND revision=?").bind(site,prior.revision));
 }
 // Journal entries and the SQLite manifest are committed in the SAME D1 transaction.
 // A large site may have 32 snapshot chunks and 32 deferred media deletes.
 // One query per deletion would exceed Free's 50-query invocation limit.
 // Use ONE bounded multi-row INSERT (<= 64 bind parameters, below D1's 100).
 if(deletes.length){
  const placeholders=deletes.map(()=>"(?,?)").join(",");
  const bindings=deletes.flatMap(key=>[site,key]);
  if(bindings.length>D1_MAX_BINDS_PER_STATEMENT)throw new Error("D1 media journal binding limit exceeded");
  commands.push(db.prepare("INSERT OR IGNORE INTO microwp_media_delete_journal(site_id,object_key) VALUES "+placeholders).bind(...bindings));
 }
 // Include the preceding manifest SELECT in the conservative Free query budget.
 if(commands.length+1>D1_FREE_QUERY_LIMIT)throw new Error("D1 Free query budget exceeded");
 // Cloudflare D1's batch API executes the series as one SQLite transaction.
 // On partial or failed writes, old manifest+chunks must remain intact.
 await db.batch(commands);
 return {changed,sha256:sha};
}

/** Validate every path, including those restored from a compromised/corrupt journal. */
export function normalizePendingMediaPaths(paths:readonly string[]):string[]{
 if(paths.length>32)throw new Error("Too many pending media deletes");
 const keys=new Set<string>();
 for(const path of paths){
  const key=path.startsWith("/www/")?r2MediaKey(path.slice(4)):null;
  if(!key)throw new Error("Unsafe pending D1 media delete path");
  keys.add(key);
 }
 return [...keys];
}
function validJournalKey(key:unknown):key is string {
 return typeof key==="string"&&key.startsWith(R2_UPLOADS_PREFIX)&&
   r2MediaKey("/wp-content/uploads/"+key.slice(R2_UPLOADS_PREFIX.length))===key;
}
/** Get persisted deletes. The DO must replay these BEFORE hydrating R2 into PHP-WASM. */
export async function readD1MediaDeleteJournal(db:D1SqlStore,siteId=DEFAULT_SITE_ID):Promise<string[]>{
 const site=safeSite(siteId);
 const result=await db.prepare("SELECT object_key FROM microwp_media_delete_journal WHERE site_id=? ORDER BY object_key ASC LIMIT 33").bind(site).all<{object_key:string}>();
 if(!result.success||result.results.length>32)throw new Error("Invalid D1 media delete journal");
 const keys=result.results.map(row=>row.object_key);
 if(!keys.every(validJournalKey))throw new Error("Unsafe D1 media delete journal entry");
 return keys;
}
/** Idempotent crash-recovery: delete R2 object first; remove the journal row last. */
export async function drainD1MediaDeleteJournal(db:D1SqlStore,media:MediaR2|undefined,siteId=DEFAULT_SITE_ID):Promise<number>{
 const site=safeSite(siteId);
 const pending=await readD1MediaDeleteJournal(db,site);
 if(pending.length===0)return 0;
 if(!media?.delete)throw new Error("R2 deletion binding required to replay D1 journal");
 // R2 supports up to 1,000 keys per delete invocation. Batch all canonical
 // keys together, and all legacy alpha aliases together. Two R2 subrequests
 // replace up to 64 individual calls, preserving Workers Free subrequest headroom.
 await media.delete(pending);
 await media.delete(pending.map(key=>key.slice(R2_UPLOADS_PREFIX.length)));
 // Acknowledge only after BOTH bulk R2 deletions succeeded. A partial R2 outage
 // leaves the full durable journal intact; repeated deletes are idempotent.
 // One bounded prepared DELETE avoids 32 separate D1 requests on Free.
 const placeholders=pending.map(()=>"?").join(",");
 const result=await db.prepare(
  "DELETE FROM microwp_media_delete_journal WHERE site_id=? AND object_key IN ("+placeholders+")"
 ).bind(site,...pending).run();
 if((result as {success?:boolean}).success===false)
  throw new Error("D1 media journal acknowledgement failed");
 return pending.length;
}
