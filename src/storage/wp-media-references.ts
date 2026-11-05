/**
 * OFFLINE / LOCAL ONLY: conservative discovery of WordPress media references.
 * This module never authorizes deletion. WordPress filters, custom plugin tables,
 * image derivative naming and serialized/encoded values cannot be proven exhaustive.
 * Never connect the result directly to R2 deletion or expose as an HTTP endpoint.
 */
import {Database} from "bun:sqlite";
import {MAX_SQLITE_BYTES} from "./sqlite-snapshot";
import {R2_UPLOADS_PREFIX,r2MediaKey} from "../media";

export interface WordPressMediaEvidence {
  complete:false;
  keys:string[];
  scannedRows:number;
  scannedTables:string[];
  reasons:string[];
  deletionAuthorized:false;
}
const MAX_ROWS=4096;
const MAX_CELL_CHARS=256*1024;
const MAX_KEYS=4096;
const MAX_TABLES=64;
const TABLE_RE=/^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
const UPLOAD_RE=/(?:https?:\/\/[^\s"'<>\\]+)?(?:\/|\\\/)?wp-content\/uploads\/([A-Za-z0-9_./-]+\.(?:jpe?g|png|gif|webp|avif|ico|pdf|txt|mp3|mp4|webm|ogg|wav))/gi;
const COMMON_WP_SUFFIXES=["posts","postmeta","options","termmeta","usermeta","commentmeta","comments"];
function addMediaFromText(value:string,keys:Set<string>):void{
  UPLOAD_RE.lastIndex=0;
  for(const match of value.matchAll(UPLOAD_RE)){
    const key=r2MediaKey("/wp-content/uploads/"+match[1]);
    if(key&&key.length<=512) keys.add(key);
    if(keys.size>MAX_KEYS)throw new Error("Too many media references");
  }
}
function result(keys:Set<string>,tables:string[],rows:number,reasons:Set<string>):WordPressMediaEvidence{
  return {complete:false,keys:[...keys].sort(),scannedRows:rows,scannedTables:tables,
    reasons:[...reasons].sort(),deletionAuthorized:false};
}
/**
 * Accept only a bounded, already verified snapshot from the private D1 loader.
 * Never claim exhaustive evidence: dynamic WordPress extensions and generated
 * derivative files have no complete, trusted manifest in this snapshot.
 */
export async function extractWordPressMediaReferences(snapshot:Uint8Array):Promise<WordPressMediaEvidence>{
  const keys=new Set<string>();
  const scannedTables:string[]=[];
  const reasons=new Set<string>([
    "WordPress/plugin references and dynamically generated thumbnail derivatives cannot be proven exhaustive"
  ]);
  let scannedRows=0;
  if(!(snapshot instanceof Uint8Array)||snapshot.byteLength<100||snapshot.byteLength>MAX_SQLITE_BYTES){
    reasons.add("Invalid or oversized SQLite snapshot");
    return result(keys,scannedTables,scannedRows,reasons);
  }
  const header=new TextDecoder().decode(snapshot.subarray(0,16));
  if(header!=="SQLite format 3\u0000"){
    reasons.add("Invalid SQLite header");
    return result(keys,scannedTables,scannedRows,reasons);
  }
  let db:Database|undefined;
  try{
    db=Database.deserialize(snapshot);
    db.exec("PRAGMA query_only=ON");
    const quick=db.query("PRAGMA quick_check(1)").get() as Record<string,unknown>|null;
    if(!quick||!Object.values(quick).includes("ok"))throw new Error("SQLite integrity check failed");
    const tables=db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 65").all() as {name:string}[];
    if(tables.length>MAX_TABLES)throw new Error("Too many SQLite tables");
    for(const {name} of tables){
      if(!TABLE_RE.test(name))throw new Error("Unsafe SQLite table name");
      if(!COMMON_WP_SUFFIXES.some(s=>name.endsWith("_"+s)))reasons.add("Unknown table or plugin data: "+name);
      const cols=db.query('PRAGMA table_info("'+name+'")').all() as {name:string;type:string}[];
      if(cols.length>64||cols.some(c=>!TABLE_RE.test(c.name)))throw new Error("Invalid table schema");
      const count=db.query('SELECT count(*) AS n FROM "'+name+'"').get() as {n:number};
      if(!Number.isSafeInteger(count?.n)||count.n<0||count.n>MAX_ROWS-scannedRows)throw new Error("Snapshot exceeds row scan limit");
      // Iterate bounded rows without relying on plugin-specific table schemas.
      const rows=db.query('SELECT * FROM "'+name+'" LIMIT '+(MAX_ROWS-scannedRows+1)).all() as Record<string,unknown>[];
      if(rows.length>MAX_ROWS-scannedRows)throw new Error("Snapshot exceeds row scan limit");
      for(const row of rows){
        scannedRows++;
        for(const value of Object.values(row)){
          if(typeof value==="string"){
            if(value.length>MAX_CELL_CHARS)throw new Error("Oversized SQLite text cell");
            addMediaFromText(value,keys);
          }else if(value instanceof Uint8Array){
            // Binary/encoded plugin content cannot be confidently decoded.
            reasons.add("Opaque binary value in "+name);
          }else if(value!==null&&typeof value!=="number"&&typeof value!=="bigint"){
            reasons.add("Unrecognized SQLite value in "+name);
          }
        }
      }
      scannedTables.push(name);
    }
    if(!tables.some(t=>t.name.endsWith("_posts")))reasons.add("Missing WordPress posts table");
    if(!tables.some(t=>t.name.endsWith("_postmeta")))reasons.add("Missing WordPress postmeta table");
    // Relative attachment metadata (e.g. 2026/11/a.png) is not safely
    // mappable without cross-table context; never silently treat it as absent.
    reasons.add("Relative attachment paths, GUID variants and serialized metadata may contain additional references");
  }catch(error){
    reasons.add("SQLite evidence scan failed: "+(error instanceof Error?error.message:"unknown error"));
  }finally{
    db?.close();
  }
  return result(keys,scannedTables,scannedRows,reasons);
}
/** Compatible shape only through explicit failure: planner requires complete:true. */
export async function extractReferencesForOrphanAudit(snapshot:Uint8Array):Promise<never>{
  const evidence=await extractWordPressMediaReferences(snapshot);
  throw new Error("Incomplete D1 reference evidence: "+evidence.reasons.join("; "));
}
