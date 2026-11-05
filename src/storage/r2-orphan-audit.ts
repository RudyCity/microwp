/**
 * Offline/private-only R2 uploads reconciliation. This module never deletes R2
 * objects or mutates D1. Do not expose it through public HTTP routes.
 *
 * Snapshot bytes are verified by loadD1SQLite. The caller must supply a
 * trusted, exhaustive SQLite reference extractor (including derivatives and
 * references outside attachment rows). This module cannot infer references
 * from the opaque SQLite image itself.
 */
import {loadD1SQLite,DEFAULT_SITE_ID,type D1SqlStore} from "./d1-sqlite";
import {MAX_MEDIA_BYTES,R2_UPLOADS_PREFIX,r2MediaKey} from "../media";

export const ORPHAN_AUDIT_VERSION=1 as const;
export const MAX_AUDIT_OBJECTS=32;
export const MAX_AUDIT_TOTAL_BYTES=16*1024*1024;
const MAX_KEY_LENGTH=512;

type R2Entry={key:string;size:number};
export interface OrphanAuditR2 {
  list(options:{prefix:string;limit:number}):Promise<unknown>;
}
export interface ReferenceEvidence {
  /** True ONLY if all references, including generated thumbnails, were scanned. */
  complete:true;
  keys:readonly string[];
}
export interface OrphanAuditDeps {
  db:D1SqlStore;
  r2:OrphanAuditR2;
  /** Trusted offline parser; never use untrusted externally supplied key lists. */
  extractReferences:(verifiedSnapshot:Uint8Array)=>Promise<ReferenceEvidence>;
  siteId?:string;
}
export interface OrphanAuditReport {
  version:typeof ORPHAN_AUDIT_VERSION;
  mode:"dry-run";
  siteId:string;
  prefix:typeof R2_UPLOADS_PREFIX;
  snapshotRevision:string;
  totalObjects:number;
  totalBytes:number;
  referenced:string[];
  journalPending:string[];
  candidates:{key:string;size:number;reason:"unreferenced-in-snapshot"}[];
  /** Candidate status is NOT authorization to delete any object. */
  deletionAuthorized:false;
}

function safeKey(value:unknown):value is string {
  if(typeof value!=="string"||value.length<=R2_UPLOADS_PREFIX.length||value.length>MAX_KEY_LENGTH)return false;
  if(!value.startsWith(R2_UPLOADS_PREFIX)||/[\u0000-\u001f\u007f\\?#%]/.test(value))return false;
  const relative=value.slice(R2_UPLOADS_PREFIX.length);
  if(relative.split("/").some(s=>!s||s==="."||s===".."||s.startsWith(".")))return false;
  return r2MediaKey("/wp-content/uploads/"+relative)===value;
}
function validKeys(value:unknown,max:number,label:string):string[]{
  if(!Array.isArray(value)||value.length>max)throw new Error("Invalid or oversized "+label);
  const out=new Set<string>();
  for(const key of value){
    if(!safeKey(key)||out.has(key))throw new Error("Unsafe or duplicate "+label+" key");
    out.add(key);
  }
  return [...out].sort();
}
function validListing(value:unknown):R2Entry[]{
  if(!value||typeof value!=="object")throw new Error("Corrupt R2 listing");
  const listing=value as Record<string,unknown>;
  if(listing.truncated!==false||!Array.isArray(listing.objects)||listing.objects.length>MAX_AUDIT_OBJECTS)
    throw new Error("Truncated or oversized R2 listing");
  const seen=new Set<string>();
  let total=0;
  const out:R2Entry[]=[];
  for(const item of listing.objects){
    if(!item||typeof item!=="object")throw new Error("Corrupt R2 listing item");
    const obj=item as Record<string,unknown>;
    if(!safeKey(obj.key)||seen.has(obj.key)||!Number.isSafeInteger(obj.size)||
       (obj.size as number)<0||(obj.size as number)>MAX_MEDIA_BYTES)
      throw new Error("Unsafe, duplicate, or oversized R2 listing item");
    seen.add(obj.key);
    total+=obj.size as number;
    if(total>MAX_AUDIT_TOTAL_BYTES)throw new Error("R2 listing exceeds total byte limit");
    out.push({key:obj.key,size:obj.size as number});
  }
  return out.sort((a,b)=>a.key.localeCompare(b.key));
}
function safeSiteId(siteId:string):string {
  if(!/^[a-zA-Z0-9:_-]{1,90}$/.test(siteId))throw new Error("Unsafe D1 site ID");
  return siteId;
}
interface RevisionRow{revision:string}
async function readRevision(db:D1SqlStore,siteId:string):Promise<string|null>{
  const row=await db.prepare("SELECT revision FROM microwp_db_snapshots WHERE site_id=?").bind(siteId).first<RevisionRow>();
  if(row===null)return null;
  if(typeof row.revision!=="string"||!/^[0-9a-f-]{36}$/.test(row.revision))throw new Error("Invalid D1 revision");
  return row.revision;
}
async function readJournal(db:D1SqlStore,siteId:string):Promise<string[]>{
  const res=await db.prepare("SELECT object_key FROM microwp_media_delete_journal WHERE site_id=? ORDER BY object_key ASC LIMIT 33")
    .bind(siteId).all<{object_key:string}>();
  if(!res||res.success!==true||!Array.isArray(res.results))throw new Error("Corrupt D1 journal");
  return validKeys(res.results.map(row=>row?.object_key),32,"D1 journal");
}
/**
 * Bounded single-page audit: reject truncated listings instead of claiming a
 * partial scan complete. A missing/invalid snapshot is an error, NOT an empty
 * reference set. The D1 revision is checked again after R2 listing.
 */
export async function planR2OrphanAudit(deps:OrphanAuditDeps):Promise<OrphanAuditReport>{
  if(!deps||!deps.db||typeof deps.r2?.list!=="function"||typeof deps.extractReferences!=="function")
    throw new Error("D1, R2 listing and trusted evidence extractor required");
  const siteId=safeSiteId(deps.siteId??DEFAULT_SITE_ID);
  const before=await readRevision(deps.db,siteId);
  if(!before)throw new Error("Missing D1 SQLite snapshot; orphan audit refused");
  const snapshot=await loadD1SQLite(deps.db,siteId);
  if(!snapshot)throw new Error("Missing D1 SQLite snapshot; orphan audit refused");
  const evidence=await deps.extractReferences(snapshot);
  if(!evidence||evidence.complete!==true)throw new Error("Incomplete D1 reference evidence");
  const referenced=validKeys(evidence.keys,MAX_AUDIT_OBJECTS,"snapshot reference");
  const journalPending=await readJournal(deps.db,siteId);
  const listed=validListing(await deps.r2.list({prefix:R2_UPLOADS_PREFIX,limit:MAX_AUDIT_OBJECTS+1}));
  const after=await readRevision(deps.db,siteId);
  if(after!==before)throw new Error("D1 snapshot revision changed during audit");
  const protectedKeys=new Set([...referenced,...journalPending]);
  return {
    version:ORPHAN_AUDIT_VERSION,mode:"dry-run",siteId,prefix:R2_UPLOADS_PREFIX,
    snapshotRevision:before,totalObjects:listed.length,
    totalBytes:listed.reduce((n,item)=>n+item.size,0),
    referenced,journalPending,
    candidates:listed.filter(item=>!protectedKeys.has(item.key))
      .map(item=>({...item,reason:"unreferenced-in-snapshot" as const})),
    deletionAuthorized:false
  };
}
