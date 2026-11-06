/**
 * Private WordPress SQL schema-family proof against query-native D1.
 *
 * NOT a WordPress wpdb implementation: returns validated SQLite introspection,
 * not fabricated MySQL DESCRIBE/SHOW fields. The caller cannot supply raw SQL
 * to D1, a site name, an arbitrary table or a schema mutation.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export type WordPressMetadataKind="describe"|"show-tables-like";
export interface TrustedWordPressMetadataConfig {
  readonly table:"wp_options";
  readonly capability:object;
}
export interface SqliteColumnMetadata {
  readonly cid:number;
  readonly name:string;
  readonly declaredType:string;
  readonly notNull:boolean;
  readonly defaultSql:string|null;
  readonly primaryKeyPosition:number;
}
export type WordPressMetadataResult=
  | Readonly<{
      kind:"describe";table:"wp_options";columns:readonly SqliteColumnMetadata[];
      queryCount:1;mysqlDescribeCompatible:false;
    }>
  | Readonly<{
      kind:"show-tables-like";table:"wp_options";exists:boolean;
      queryCount:1;mysqlShowTablesCompatible:false;
    }>;
export const MAX_METADATA_COLUMNS=100;
export const MAX_METADATA_OUTPUT_BYTES=16*1024;
const MAX_METADATA_QUERY_BYTES=128;
const encoder=new TextEncoder();
function reject():never{
  throw Error("Private WordPress D1 metadata rejected");
}
function isCapability(value:unknown):value is object{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
function validMetadataConfig(config:unknown):config is TrustedWordPressMetadataConfig{
  if(!config||typeof config!=="object"||Array.isArray(config))return false;
  const c=config as Record<string,unknown>;
  return Object.keys(c).sort().join(",")==="capability,table"&&
    c.table==="wp_options"&&validIdentifier(c.table)&&isCapability(c.capability);
}
/**
 * Recognize only fixed, pre-prepare WordPress schema SQL spelling.
 * No SQL is forwarded or parsed via an arbitrary-SQL fallback.
 */
export function classifyWordPressMetadataQuery(
  query:string,trustedTable:"wp_options"
):WordPressMetadataKind{
  if(typeof query!=="string"||
     encoder.encode(query).byteLength>MAX_METADATA_QUERY_BYTES)return reject();
  const sql=query.trim();
  if(sql==="DESCRIBE "+trustedTable||
     sql==="DESC "+trustedTable||
     sql==="SHOW COLUMNS FROM "+trustedTable)return "describe";
  if(sql==="SHOW TABLES LIKE '"+trustedTable+"'")return "show-tables-like";
  return reject();
}
function validRow(row:unknown,keys:string):row is Record<string,unknown>{
  return !!row&&typeof row==="object"&&!Array.isArray(row)&&
    Object.keys(row).sort().join(",")===keys;
}
function withinText(value:unknown,max:number,empty=false):value is string{
  return typeof value==="string"&&!value.includes("\u0000")&&
    (empty||value.length>0)&&encoder.encode(value).byteLength<=max;
}
/**
 * A single host-owned prepared SELECT per recognized metadata family.
 * Schema metadata is global inside a given D1 database. It is not tenant
 * data, but access must still be restricted to this explicit trusted table.
 */
export async function readPrivateWordPressMetadata(
  query:string,
  config:TrustedWordPressMetadataConfig,
  db:Pick<D1Database,"prepare">,
  callerCapability:object
):Promise<WordPressMetadataResult>{
  if(!validMetadataConfig(config)||callerCapability!==config.capability||
     !isCapability(callerCapability)||!db||typeof db.prepare!=="function")
    return reject();
  const operation=classifyWordPressMetadataQuery(query,config.table);
  if(operation==="show-tables-like"){
    const sql='SELECT "name" FROM "sqlite_master" '+
      'WHERE "type" = \x27table\x27 AND "name" = ? LIMIT 2';
    let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
    try{raw=await db.prepare(sql).bind(config.table).all();}
    catch{return reject();}
    if(!raw||raw.success!==true||!Array.isArray(raw.results)||
       raw.results.length>1)return reject();
    for(const item of raw.results){
      if(!validRow(item,"name")||item.name!==config.table)return reject();
    }
    return Object.freeze({
      kind:operation,table:config.table,exists:raw.results.length===1,
      queryCount:1, mysqlShowTablesCompatible:false
    });
  }
  // Table-valued PRAGMA is read-only; a bound table name is supported by
  // SQLite/D1. No dynamic identifier interpolation or PRAGMA mutations.
  const sql='SELECT "cid","name","type","notnull","dflt_value","pk" '+
    'FROM pragma_table_info(?) ORDER BY "cid" ASC LIMIT 101';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{raw=await db.prepare(sql).bind(config.table).all();}
  catch{return reject();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length<1||raw.results.length>MAX_METADATA_COLUMNS)
    return reject();
  let total=0;
  const columns:SqliteColumnMetadata[]=[];
  const seen=new Set<string>();
  for(const item of raw.results){
    if(!validRow(item,"cid,dflt_value,name,notnull,pk,type"))return reject();
    const name=item.name,declaredType=item.type,defaultSql=item.dflt_value;
    if(item.cid!==columns.length||!validIdentifier(name)||
       seen.has(name)||!withinText(declaredType,100,true)||
       (defaultSql!==null&&!withinText(defaultSql,1024,true))||
       (item.notnull!==0&&item.notnull!==1)||
       !Number.isSafeInteger(item.pk)||
       !(typeof item.pk==="number"&&item.pk>=0&&item.pk<=MAX_METADATA_COLUMNS))
      return reject();
    total+=encoder.encode(name).byteLength+
      encoder.encode(declaredType).byteLength+
      (defaultSql===null?0:encoder.encode(defaultSql).byteLength);
    if(total>MAX_METADATA_OUTPUT_BYTES)return reject();
    seen.add(name);
    columns.push(Object.freeze({
      cid:item.cid,name,declaredType,notNull:item.notnull===1,
      defaultSql,primaryKeyPosition:item.pk
    }));
  }
  // This is explicitly the option table; fail rather than pretending a
  // schema-less or unrelated table can answer a WordPress DESCRIBE.
  for(const required of ["option_name","option_value","autoload"]){
    if(!seen.has(required))return reject();
  }
  return Object.freeze({
    kind:operation,table:config.table,columns:Object.freeze(columns),
    queryCount:1,mysqlDescribeCompatible:false
  });
}
