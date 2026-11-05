/**
 * Single-site SQLite snapshot store. Durable Object is the exclusive WordPress writer.
 * Does NOT replace normal transactions inside SQLite; persists a completed file snapshot
 * to the strongly consistent SQLite-backed DO KV transaction before returning response.
 */
export interface SnapshotManifest {v:1; revision:string; chunks:number; bytes:number; sha256:string}
export interface SnapshotStore {
  get(key:string):Promise<unknown>;
  put(key:string,value:unknown):Promise<void>;
  delete(key:string):Promise<boolean>;
  transaction<T>(callback:(tx:SnapshotStore)=>Promise<T>):Promise<T>;
}
export const SQLITE_CHUNK_BYTES=256*1024;
export const MAX_SQLITE_BYTES=8*1024*1024;
const KEY="microwp:sqlite:manifest";
export const snapshotChunkKey=(revision:string,index:number)=>`microwp:sqlite:${revision}:${index}`;
const hex=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
export async function digest(bytes:Uint8Array):Promise<string> {
  const source=new Uint8Array(bytes.byteLength);
  source.set(bytes);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",source)));
}
function isManifest(value:unknown):value is SnapshotManifest {
  if (!value||typeof value!=="object")return false;
  const v=value as Record<string,unknown>;
  return v.v===1 && typeof v.revision==="string" &&
    /^[0-9a-f-]{36}$/.test(v.revision) &&
    Number.isInteger(v.chunks) && (v.chunks as number)>0 && (v.chunks as number)<=32 &&
    Number.isInteger(v.bytes) && (v.bytes as number)>0 && (v.bytes as number)<=MAX_SQLITE_BYTES &&
    typeof v.sha256==="string" && /^[a-f0-9]{64}$/.test(v.sha256);
}
export async function loadSQLiteSnapshot(store:SnapshotStore):Promise<Uint8Array | null> {
  const manifest=await store.get(KEY);
  if (manifest===undefined || manifest===null)return null;
  if(!isManifest(manifest))throw new Error("Corrupt SQLite snapshot manifest");
  const out=new Uint8Array(manifest.bytes);
  let offset=0;
  for(let i=0;i<manifest.chunks;i++){
    const val=await store.get(snapshotChunkKey(manifest.revision,i));
    if(!(val instanceof Uint8Array))throw new Error(`Missing SQLite snapshot chunk ${i}`);
    if(val.byteLength===0||val.byteLength>SQLITE_CHUNK_BYTES||offset+val.byteLength>out.byteLength)throw new Error("Invalid SQLite snapshot chunk size");
    out.set(val,offset);offset+=val.byteLength;
  }
  if(offset!==out.byteLength)throw new Error("SQLite snapshot truncated");
  if(await digest(out)!==manifest.sha256)throw new Error("SQLite snapshot SHA256 mismatch");
  return out;
}
export async function saveSQLiteSnapshot(store:SnapshotStore,bytes:Uint8Array):Promise<{changed:boolean;sha256:string}>{
  if(bytes.byteLength===0 || bytes.byteLength>MAX_SQLITE_BYTES)throw new Error("SQLite snapshot exceeds 8MiB limit");
  const sha=await digest(bytes);
  const priorValue=await store.get(KEY);
  if(priorValue!=null&&!isManifest(priorValue))throw new Error("Corrupt SQLite snapshot manifest");
  const prior=priorValue as SnapshotManifest|undefined;
  if(prior&&prior.sha256===sha&&prior.bytes===bytes.byteLength)return {changed:false,sha256:sha};
  const revision=crypto.randomUUID();
  const chunks=Math.ceil(bytes.byteLength/SQLITE_CHUNK_BYTES);
  const manifest:SnapshotManifest={v:1,revision,chunks,bytes:bytes.byteLength,sha256:sha};
  await store.transaction(async tx=>{
    for(let i=0;i<chunks;i++) await tx.put(snapshotChunkKey(revision,i),bytes.slice(i*SQLITE_CHUNK_BYTES,Math.min((i+1)*SQLITE_CHUNK_BYTES,bytes.byteLength)));
    await tx.put(KEY,manifest);
    if(prior)for(let i=0;i<prior.chunks;i++)await tx.delete(snapshotChunkKey(prior.revision,i));
  });
  return {changed:true,sha256:sha};
}
