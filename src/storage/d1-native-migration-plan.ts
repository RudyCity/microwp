/**
 * Bounded, offline-only SQLite snapshot migration proposal. Never pass its SQL
 * to D1, an HTTP route, or a production database. Source bytes are retained.
 *
 * DDL from sqlite_master is replayed ONLY in local ephemeral bun:sqlite, and
 * only after strict object/identifier/SQL-shape and size validation.
 */
import {Database} from "bun:sqlite";
import {MAX_SQLITE_BYTES,digest} from "./sqlite-snapshot";

export const MIGRATION_MAX_ROWS=2048;
export const MIGRATION_MAX_TABLES=32;
export const MIGRATION_MAX_INDEXES=64;
export const MIGRATION_MAX_TOTAL_BYTES=2*1024*1024;
const MAX_CELL_BYTES=128*1024;
const MAX_COLUMNS=32;
const MAX_DDL_BYTES=64*1024;
const ID=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const CORE=new Set(["posts","postmeta","options","users","usermeta","terms","termmeta",
  "term_taxonomy","term_relationships","comments","commentmeta","links"]);
const SQLITE_METADATA=/^_wp_sqlite_(?:global_variables|mysql_information_schema_(?:schemata|tables|columns|statistics|table_constraints|referential_constraints|key_column_usage|check_constraints))$/;
export type Cell=string|number|bigint|Uint8Array|null;
export interface InsertPlan {readonly sql:string;readonly params:readonly Cell[]}
export interface TablePlan {
  readonly name:string;readonly createSQL:string;readonly insertSQL:string;
  readonly columns:readonly string[];readonly rows:readonly (readonly Cell[])[];
}
export interface SchemaIndex {readonly name:string;readonly table:string;readonly createSQL:string}
export interface SequencePlan {readonly name:string;readonly seq:number|bigint}
export interface NativeD1MigrationPlan {
  readonly kind:"offline-proposal";
  readonly sourceSha256:string;readonly sourceBytes:number;
  readonly rollback:{readonly strategy:"retain-original-verified-snapshot";readonly sha256:string;readonly originalSnapshot:Uint8Array};
  readonly tables:readonly TablePlan[];readonly indexes:readonly SchemaIndex[];
  readonly sequences:readonly SequencePlan[];
  readonly rowCount:number;readonly insertStatements:readonly InsertPlan[];
  readonly productionReady:false;readonly remoteExecutionAllowed:false;
}
export interface MigrationOptions {readonly allowedPluginTables?:readonly string[]}
function deny(message:string):never {throw new Error("Unsupported offline migration: "+message)}
function quoteId(v:string):string {if(!ID.test(v))deny("unsafe identifier");return '"'+v+'"'}
function checkedCell(value:unknown):Cell {
  if(value===null)return null;
  if(typeof value==="string"&&new TextEncoder().encode(value).length<=MAX_CELL_BYTES)return value;
  if(typeof value==="number"&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)))return value;
  if(typeof value==="bigint")return value;
  if(value instanceof Uint8Array&&value.byteLength<=MAX_CELL_BYTES)return new Uint8Array(value);
  return deny("unsupported or oversized SQLite cell");
}
type Master={type:string;name:string;tbl_name:string;sql:string|null};
type Column={cid:number;name:string;type:string;notnull:number;dflt_value:unknown;pk:number;hidden:number};
function validateDDL(entry:Master):string {
  const sql=entry.sql;
  if(typeof sql!=="string"||sql.length<15||new TextEncoder().encode(sql).length>MAX_DDL_BYTES)
    deny("missing or oversized DDL");
  // Do not accept additional statements, comments, attachment, virtual tables,
  // or any other instruction not represented by an ordinary schema object.
  // WordPress SQLite Integration ships SQL comments inside its trusted
  // metadata table DDL. No blanket exemption for plugin/core table schemas.
  const knownMetadata=entry.type==="table"&&SQLITE_METADATA.test(entry.name);
  if(/[;\u0000]/.test(sql)||
      (!knownMetadata&&(/--|\/\*|\*\//.test(sql)||
       /\b(?:ATTACH|DETACH|PRAGMA|VIRTUAL|TEMP|TRIGGER|CREATE\s+VIEW|LOAD_EXTENSION)\b/i.test(sql))))
    deny("unsupported DDL syntax");
  const shape=entry.type==="table"
    ?/^\s*CREATE\s+TABLE\s+(?:`?([A-Za-z_][A-Za-z0-9_]*)`?|\x22([A-Za-z_][A-Za-z0-9_]*)\x22)\s*\(/i
    :/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:`?([A-Za-z_][A-Za-z0-9_]*)`?|\x22([A-Za-z_][A-Za-z0-9_]*)\x22)\s+ON\s+/i;
  const match=shape.exec(sql);
  if(!match|| (match[1]??match[2])!==entry.name)deny("DDL name or statement mismatch");
  return sql;
}
function tableAllowed(name:string,plugins:Set<string>):boolean{
  return name.startsWith("wp_")&&CORE.has(name.slice(3))||
    SQLITE_METADATA.test(name)||plugins.has(name);
}
function masterObjects(db:Database,plugins:Set<string>):{tables:Master[];indexes:Master[]}{
  const entries=db.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name LIMIT 129").all() as Master[];
  if(entries.length>128)deny("schema object count");
  const tables:Master[]=[],indexes:Master[]=[];
  for(const entry of entries){
    if(entry.name==="sqlite_sequence"&&entry.type==="table")continue;
    if(entry.type==="index"&&entry.name.startsWith("sqlite_autoindex_")){
      if(entry.sql!==null)deny("unexpected autoindex definition");
      continue;
    }
    if(!ID.test(entry.name)||!ID.test(entry.tbl_name))deny("unsafe schema object identifier");
    if(entry.type==="table"){
      if(!tableAllowed(entry.name,plugins)||entry.tbl_name!==entry.name)deny("non-whitelisted table or plugin");
      validateDDL(entry);
      tables.push(entry);
    }else if(entry.type==="index"){
      if(!tableAllowed(entry.tbl_name,plugins))deny("index on unknown table");
      validateDDL(entry);
      indexes.push(entry);
    }else deny("views, triggers, virtual tables or unsupported schema objects");
  }
  if(!tables.length||tables.length>MIGRATION_MAX_TABLES||indexes.length>MIGRATION_MAX_INDEXES)
    deny("schema table/index limit");
  for(const index of indexes)if(!tables.some(t=>t.name===index.tbl_name))
    deny("orphan schema index");
  return {tables,indexes};
}
function columnNames(db:Database,table:string):string[]{
  const columns=db.query("PRAGMA table_xinfo("+quoteId(table)+")").all() as Column[];
  if(!columns.length||columns.length>MAX_COLUMNS)deny("column count");
  const used=new Set<string>();
  for(const c of columns){
    if(!ID.test(c.name)||used.has(c.name)||c.cid<0||c.hidden!==0)
      deny("hidden, generated or unsafe column");
    used.add(c.name);
  }
  return columns.map(c=>c.name);
}
function quoteInternalIndex(value:string):string {
  if(ID.test(value))return quoteId(value);
  if(/^sqlite_autoindex_[A-Za-z0-9_]{1,180}$/.test(value))
    return '"'+value+'"';
  return deny("unsafe internal index identifier");
}
function schemaFingerprint(db:Database):string {
  const master=db.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name <> 'sqlite_sequence' ORDER BY type,name").all();
  const details=(master as Master[]).filter(x=>x.type==="table").map(x=>({
    name:x.name,columns:db.query("PRAGMA table_xinfo("+quoteId(x.name)+")").all(),
    foreignKeys:db.query("PRAGMA foreign_key_list("+quoteId(x.name)+")").all(),
    indexes:db.query("PRAGMA index_list("+quoteId(x.name)+")").all()
      .map((idx:any)=>({name:idx.name,unique:idx.unique,origin:idx.origin,partial:idx.partial,
        xinfo:db.query("PRAGMA index_xinfo("+quoteInternalIndex(idx.name)+")").all()}))
       .sort((a,b)=>a.name.localeCompare(b.name))
  }));
  return JSON.stringify({master,details});
}
function readSequences(db:Database):SequencePlan[]{
  const table=db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
  if(!table)return [];
  const rows=db.query("SELECT name,seq FROM sqlite_sequence ORDER BY name").all() as SequencePlan[];
  if(rows.length>MIGRATION_MAX_TABLES)deny("too many sequence rows");
  const used=new Set<string>();
  for(const r of rows){
    if(!ID.test(r.name)||used.has(r.name)||!(typeof r.seq==="bigint"||
       typeof r.seq==="number"&&Number.isSafeInteger(r.seq))||r.seq<0)
      deny("invalid sequence value");
    used.add(r.name);
  }
  return rows.map(x=>({name:x.name,seq:x.seq}));
}
function valuesSignature(db:Database,name:string,columns:readonly string[]):string[]{
  const expr=columns.map((c,i)=>"typeof("+quoteId(c)+") AS "+quoteId("t"+i));
  const vals=db.query("SELECT "+[...columns.map(quoteId),...expr].join(",")+" FROM "+quoteId(name)).all() as Record<string,unknown>[];
  return vals.map(row=>JSON.stringify(columns.map((col,i)=>{
    const v=row[col];
    return [row["t"+i],v instanceof Uint8Array?Array.from(v):
      typeof v==="bigint"?v.toString():v];
  }))).sort();
}
/**
 * Plan never performs remote mutations. An explicit allowlist is required for
 * plugin tables outside WordPress core and known sqlite-integration metadata.
 */
export async function planNativeD1Migration(snapshot:Uint8Array,
 options:MigrationOptions={}):Promise<NativeD1MigrationPlan>{
  if(!(snapshot instanceof Uint8Array)||snapshot.length<100||snapshot.length>MAX_SQLITE_BYTES)
    deny("invalid snapshot length");
  if(new TextDecoder().decode(snapshot.subarray(0,16))!=="SQLite format 3\u0000")
    deny("invalid SQLite header");
  const plugins=new Set(options.allowedPluginTables??[]);
  if(plugins.size>16||plugins.size!==(options.allowedPluginTables??[]).length||
     [...plugins].some(p=>!ID.test(p)||!/^wp_[A-Za-z0-9_]+$/.test(p)||CORE.has(p.slice(3))))
    deny("invalid plugin allowlist");
  const originalSnapshot=new Uint8Array(snapshot);
  let source:Database|undefined;
  try{
    source=Database.deserialize(originalSnapshot);
    source.exec("PRAGMA query_only=ON");
    const check=source.query("PRAGMA integrity_check(1)").get() as Record<string,unknown>|null;
    if(!check||!Object.values(check).includes("ok"))deny("SQLite integrity");
    const schema=masterObjects(source,plugins);
    let rowCount=0,payloadBytes=0;
    const tables:TablePlan[]=[];
    const insertStatements:InsertPlan[]=[];
    for(const entry of schema.tables){
      const columns=columnNames(source,entry.name);
      const count=(source.query("SELECT count(*) AS n FROM "+quoteId(entry.name)).get() as {n:number}).n;
      if(!Number.isSafeInteger(count)||count<0||count>MIGRATION_MAX_ROWS-rowCount)
        deny("row count exceeds limit");
      const insertSQL="INSERT INTO "+quoteId(entry.name)+" ("+columns.map(quoteId).join(", ")+
        ") VALUES ("+columns.map(()=>"?").join(", ")+")";
      const rows:Cell[][]=[];
      const data=source.query("SELECT "+columns.map(quoteId).join(",")+" FROM "+quoteId(entry.name)+
        " LIMIT "+(count+1)).all() as Record<string,unknown>[];
      if(data.length!==count)deny("row count mismatch");
      for(const record of data){
        const values=columns.map(col=>checkedCell(record[col]));
        for(const v of values){
          payloadBytes+=v===null?1:v instanceof Uint8Array?v.length:
            typeof v==="string"?new TextEncoder().encode(v).length:8;
          if(payloadBytes>MIGRATION_MAX_TOTAL_BYTES)deny("SQL payload byte limit");
        }
        rows.push(values);
        insertStatements.push({sql:insertSQL,params:values.map(v=>v instanceof Uint8Array?new Uint8Array(v):v)});
      }
      rowCount+=count;
      tables.push({name:entry.name,createSQL:entry.sql!,insertSQL,columns,rows});
    }
    const indexes=schema.indexes.map(x=>({name:x.name,table:x.tbl_name,createSQL:x.sql!}));
    const sequences=readSequences(source);
    if(sequences.some(s=>!tables.some(t=>t.name===s.name)))deny("orphan sequence");
    const sha=await digest(originalSnapshot);
    return {kind:"offline-proposal",sourceSha256:sha,sourceBytes:originalSnapshot.length,
      rollback:{strategy:"retain-original-verified-snapshot",sha256:sha,originalSnapshot},
      tables,indexes,sequences,rowCount,insertStatements,productionReady:false,remoteExecutionAllowed:false};
  }catch(e){
    if(e instanceof Error&&e.message.startsWith("Unsupported offline migration:"))throw e;
    return deny("SQLite parse or inspection failure");
  }finally{source?.close()}
}
/** Roundtrip is purely local. Source image must remain immutable and verified. */
export async function verifyNativeD1MigrationRoundtrip(plan:NativeD1MigrationPlan):Promise<{
  verified:true;rowCount:number;sourceSnapshotRetained:true;schemaParity:true;sequenceParity:true
}>{
  if(plan.kind!=="offline-proposal"||plan.remoteExecutionAllowed!==false||plan.productionReady!==false)
    deny("invalid or remotely executable plan");
  if(await digest(plan.rollback.originalSnapshot)!==plan.sourceSha256||
     plan.rollback.sha256!==plan.sourceSha256)deny("rollback snapshot hash mismatch");
  const source=Database.deserialize(new Uint8Array(plan.rollback.originalSnapshot));
  const target=new Database(":memory:");
  try{
    source.exec("PRAGMA query_only=ON");
    target.exec("PRAGMA foreign_keys=OFF");
    for(const table of plan.tables)target.prepare(table.createSQL).run();
    let count=0;
    for(const table of plan.tables){
      const insert=target.prepare(table.insertSQL);
      for(const row of table.rows){insert.run(...row);count++}
    }
    // Recreate indexes after data, including unique constraints.
    for(const index of plan.indexes)target.prepare(index.createSQL).run();
    // sqlite_sequence is SQLite-owned; restore even seq > max(PK).
    if(plan.sequences.length){
      const seqTable=target.query("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get();
      if(!seqTable)deny("missing sqlite_sequence");
      target.prepare("DELETE FROM sqlite_sequence").run();
      const insert=target.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)");
      for(const s of plan.sequences)insert.run(s.name,s.seq);
    }
    if(count!==plan.rowCount)deny("roundtrip row count mismatch");
    if(schemaFingerprint(source)!==schemaFingerprint(target))deny("roundtrip structural/index parity mismatch");
    if(JSON.stringify(readSequences(source))!==JSON.stringify(readSequences(target)))
      deny("roundtrip sqlite_sequence mismatch");
    for(const table of plan.tables){
      if(JSON.stringify(valuesSignature(source,table.name,table.columns))!==
         JSON.stringify(valuesSignature(target,table.name,table.columns)))
        deny("roundtrip storage class or data mismatch: "+table.name);
    }
    const check=target.query("PRAGMA integrity_check(1)").get() as Record<string,unknown>|null;
    if(!check||!Object.values(check).includes("ok"))deny("roundtrip integrity mismatch");
    return {verified:true,rowCount:count,sourceSnapshotRetained:true,schemaParity:true,sequenceParity:true};
  }finally{source.close();target.close()}
}
