/**
 * D1 durable storage for the PHP-WASM SQLite file.
 *
 * D1 is the durable source of truth. The SQLite plugin still runs PDO against
 * an ephemeral file in the PHP-WASM filesystem. This adapter stores that
 * file as bounded BLOB chunks in D1 transactions. This is NOT direct WordPress
 * SQL dispatch to D1. Do not confuse a bridge with a native D1 wpdb driver.
 */
import {digest,MAX_SQLITE_BYTES,SQLITE_CHUNK_BYTES} from "./sqlite-snapshot";

export type D1SqlStore = Pick<D1Database,"prepare"|"batch">;
export const DEFAULT_SITE_ID="microwp:single-site:v1";
const MAX_PARTS=Math.ceil(MAX_SQLITE_BYTES/SQLITE_CHUNK_BYTES);
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
export async function saveD1SQLite(db:D1SqlStore,sqlite:Uint8Array,siteId=DEFAULT_SITE_ID):Promise<D1SnapshotResult>{
 const site=safeSite(siteId);
 if(sqlite.length===0||sqlite.length>MAX_SQLITE_BYTES)throw new Error("SQLite snapshot exceeds 8MiB limit");
 const sha=await digest(sqlite);
 const prior=await db.prepare("SELECT revision,bytes,sha256,parts FROM microwp_db_snapshots WHERE site_id=?").bind(site).first<ManifestRow>();
 if(prior!==null&&!validManifest(prior))throw new Error("Invalid existing D1 SQLite manifest");
 if(prior&&prior.sha256===sha&&prior.bytes===sqlite.length)return {changed:false,sha256:sha};
 const revision=crypto.randomUUID();
 const parts=Math.ceil(sqlite.length/SQLITE_CHUNK_BYTES);
 const commands=[];
 for(let i=0;i<parts;i++){
  const begin=i*SQLITE_CHUNK_BYTES;
  const slice=sqlite.slice(begin,Math.min(begin+SQLITE_CHUNK_BYTES,sqlite.length));
  commands.push(db.prepare("INSERT INTO microwp_db_chunks(site_id,revision,part,payload) VALUES(?,?,?,?)").bind(site,revision,i,slice));
 }
 commands.push(db.prepare("INSERT INTO microwp_db_snapshots(site_id,revision,bytes,sha256,parts) VALUES(?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,bytes=excluded.bytes,sha256=excluded.sha256,parts=excluded.parts").bind(site,revision,sqlite.length,sha,parts));
 if(prior)commands.push(db.prepare("DELETE FROM microwp_db_chunks WHERE site_id=? AND revision=?").bind(site,prior.revision));
 // Cloudflare D1's batch API executes the series as one SQLite transaction.
 // On partial or failed writes, old manifest+chunks must remain intact.
 await db.batch(commands);
 return {changed:true,sha256:sha};
}
