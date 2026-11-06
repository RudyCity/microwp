/**
 * Private query-native D1 read proof for WordPress posts and postmeta.
 *
 * Host-only and non-installed: no caller SQL, table, projection, scope, order
 * or LIMIT is accepted. Inputs are bounded IDs and an opaque capability.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export const CORE_POST_BATCH_MAX_IDS=16;
export const CORE_POSTMETA_BATCH_MAX_IDS=32;
export const CORE_POSTMETA_MAX_ROWS=256;
export const CORE_POST_VALUE_MAX_BYTES=32*1024;
export const CORE_POSTMETA_VALUE_MAX_BYTES=8*1024;
export const CORE_READ_TOTAL_MAX_BYTES=256*1024;

export interface TrustedCoreReadConfig {
  readonly scope:{readonly column:string;readonly value:string};
  readonly postsCapability:object;
  readonly postMetaCapability:object;
}
export interface CorePostRow {
  readonly ID:number;
  readonly post_author:number;
  readonly post_date:string;
  readonly post_date_gmt:string;
  readonly post_content:string;
  readonly post_title:string;
  readonly post_excerpt:string;
  readonly post_status:string;
  readonly comment_status:string;
  readonly ping_status:string;
  readonly post_password:string;
  readonly post_name:string;
  readonly to_ping:string;
  readonly pinged:string;
  readonly post_modified:string;
  readonly post_modified_gmt:string;
  readonly post_content_filtered:string;
  readonly post_parent:number;
  readonly guid:string;
  readonly menu_order:number;
  readonly post_type:string;
  readonly post_mime_type:string;
  readonly comment_count:number;
}
export interface CorePostMetaRow {
  readonly meta_id:number;
  readonly post_id:number;
  readonly meta_key:string|null;
  readonly meta_value:string|null;
}
export interface CoreReadDatabase {prepare:D1Database["prepare"]}

const encoder=new TextEncoder();
const POST_STRING_COLUMNS=[
  "post_date","post_date_gmt","post_content","post_title","post_excerpt",
  "post_status","comment_status","ping_status","post_password","post_name",
  "to_ping","pinged","post_modified","post_modified_gmt",
  "post_content_filtered","guid","post_type","post_mime_type"
] as const;
const POST_INTEGER_COLUMNS=[
  "ID","post_author","post_parent","menu_order","comment_count"
] as const;
const POST_COLUMNS=[...POST_INTEGER_COLUMNS,...POST_STRING_COLUMNS] as const;
const META_COLUMNS=["meta_id","post_id","meta_key","meta_value"] as const;

function refuse():never{throw Error("Private WordPress core D1 read rejected");}
function capability(value:unknown):value is object{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
function boundedString(value:unknown,max:number,nullable=false):value is string|null{
  if(value===null)return nullable;
  return typeof value==="string"&&!value.includes("\u0000")&&
    encoder.encode(value).byteLength<=max;
}
function integer(value:unknown):value is number{
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
}
function validIds(value:unknown,max:number):value is readonly number[]{
  if(!Array.isArray(value)||value.length<1||value.length>max)return false;
  for(let i=0;i<value.length;i++){
    if(!Object.hasOwn(value,i)||!integer(value[i])||value[i]===0)return false;
  }
  return new Set(value).size===value.length;
}
function validConfig(config:unknown):config is TrustedCoreReadConfig{
  if(!config||typeof config!=="object"||Array.isArray(config))return false;
  const c=config as Record<string,unknown>;
  const s=c.scope;
  if(!s||typeof s!=="object"||Array.isArray(s))return false;
  const scope=s as Record<string,unknown>;
  return Object.keys(c).sort().join(",")==="postMetaCapability,postsCapability,scope"&&
    Object.keys(scope).sort().join(",")==="column,value"&&
    validIdentifier(scope.column)&&
    !POST_COLUMNS.includes(scope.column as never)&&
    !META_COLUMNS.includes(scope.column as never)&&
    typeof scope.value==="string"&&scope.value.length>0&&
    !scope.value.includes("\u0000")&&encoder.encode(scope.value).byteLength<=191&&
    capability(c.postsCapability)&&capability(c.postMetaCapability)&&
    c.postsCapability!==c.postMetaCapability;
}
function safeTable(table:string):string{
  if(!validIdentifier(table))return refuse();
  return '"'+table+'"';
}
function stringProjection(name:string,max:number):string{
  if(!validIdentifier(name))return refuse();
  const q='"'+name+'"';
  return "CASE WHEN typeof("+q+") = 'text' AND length(CAST("+q+
    " AS BLOB)) <= ? THEN "+q+" ELSE NULL END AS "+q;
}
function nullableStringProjection(name:string):string{
  if(!validIdentifier(name))return refuse();
  const q='"'+name+'"';
  // Genuine SQL NULL remains NULL. Invalid type/oversize becomes integer 0,
  // which the response validator rejects rather than treating as missing.
  return "CASE WHEN "+q+" IS NULL THEN NULL WHEN typeof("+q+
    ") = 'text' AND length(CAST("+q+" AS BLOB)) <= ? THEN "+q+
    " ELSE 0 END AS "+q;
}
function rowKeys(row:Record<string,unknown>,expected:readonly string[]):boolean{
  const keys=Object.keys(row).sort();
  return keys.length===expected.length&&
    keys.every((key,index)=>key===[...expected].sort()[index]);
}
function addStringBytes(total:number,value:string|null):number{
  return total+(value===null?0:encoder.encode(value).byteLength);
}

/**
 * Reads complete core post rows for 1..16 IDs in one prepared D1 SELECT.
 * The artificial scope column belongs to this research fixture, not canonical
 * WordPress wp_posts; a real migration strategy remains a separate blocker.
 */
export async function readPrivateCorePostsByIds(
  ids:readonly number[],config:TrustedCoreReadConfig,db:CoreReadDatabase,
  callerCapability:object
):Promise<readonly CorePostRow[]>{
  if(!validConfig(config)||callerCapability!==config.postsCapability||
     !capability(callerCapability)||!validIds(ids,CORE_POST_BATCH_MAX_IDS)||
     !db||typeof db.prepare!=="function")return refuse();
  const requested=Object.freeze([...ids]);
  const table=safeTable("wp_posts"),scope=safeTable(config.scope.column);
  const projections=[
    ...POST_INTEGER_COLUMNS.map(name=>'"'+name+'"'),
    ...POST_STRING_COLUMNS.map(name=>stringProjection(name,CORE_POST_VALUE_MAX_BYTES))
  ];
  const sql="SELECT "+projections.join(", ")+" FROM "+table+
    " WHERE "+scope+" = ? AND \"ID\" IN ("+
    requested.map(()=>"?").join(", ")+
    ") ORDER BY \"ID\" ASC LIMIT ?";
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      ...POST_STRING_COLUMNS.map(()=>CORE_POST_VALUE_MAX_BYTES),
      config.scope.value,...requested,requested.length+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>requested.length)return refuse();
  const wanted=new Set(requested),seen=new Set<number>();
  const rows:CorePostRow[]=[];
  let previous=0,total=0;
  for(const candidate of raw.results){
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))
      return refuse();
    const row=candidate as Record<string,unknown>;
    if(!rowKeys(row,POST_COLUMNS))return refuse();
    for(const col of POST_INTEGER_COLUMNS)if(!integer(row[col]))return refuse();
    for(const col of POST_STRING_COLUMNS){
      if(!boundedString(row[col],CORE_POST_VALUE_MAX_BYTES))return refuse();
      total=addStringBytes(total,row[col] as string);
    }
    const id=row.ID as number;
    if(!wanted.has(id)||seen.has(id)||id<=previous)return refuse();
    previous=id;seen.add(id);
    if(total>CORE_READ_TOTAL_MAX_BYTES)return refuse();
    rows.push(Object.freeze(row as unknown as CorePostRow));
  }
  return Object.freeze(rows);
}

/**
 * Mirrors the structural purpose of WordPress meta-cache reads:
 * post_id IN (...) ordered by meta_id. It is not wired into update_meta_cache.
 */
export async function readPrivatePostMetaByPostIds(
  postIds:readonly number[],config:TrustedCoreReadConfig,db:CoreReadDatabase,
  callerCapability:object
):Promise<readonly CorePostMetaRow[]>{
  if(!validConfig(config)||callerCapability!==config.postMetaCapability||
     !capability(callerCapability)||!validIds(postIds,CORE_POSTMETA_BATCH_MAX_IDS)||
     !db||typeof db.prepare!=="function")return refuse();
  const requested=Object.freeze([...postIds]),wanted=new Set(requested);
  const table=safeTable("wp_postmeta"),scope=safeTable(config.scope.column);
  const sql="SELECT \"meta_id\", \"post_id\", "+
    nullableStringProjection("meta_key")+", "+
    nullableStringProjection("meta_value")+
    " FROM "+table+" WHERE "+scope+" = ? AND \"post_id\" IN ("+
    requested.map(()=>"?").join(", ")+
    ") ORDER BY \"meta_id\" ASC LIMIT ?";
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      CORE_POSTMETA_VALUE_MAX_BYTES,CORE_POSTMETA_VALUE_MAX_BYTES,
      config.scope.value,...requested,CORE_POSTMETA_MAX_ROWS+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>CORE_POSTMETA_MAX_ROWS)return refuse();
  const rows:CorePostMetaRow[]=[];
  let previous=0,total=0;
  for(const candidate of raw.results){
    if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))
      return refuse();
    const row=candidate as Record<string,unknown>;
    if(!rowKeys(row,META_COLUMNS)||!integer(row.meta_id)||!integer(row.post_id)||
       row.post_id===0||!wanted.has(row.post_id)||
       !boundedString(row.meta_key,CORE_POSTMETA_VALUE_MAX_BYTES,true)||
       !boundedString(row.meta_value,CORE_POSTMETA_VALUE_MAX_BYTES,true)||
       (row.meta_id as number)<=previous)return refuse();
    previous=row.meta_id as number;
    total=addStringBytes(total,row.meta_key as string|null);
    total=addStringBytes(total,row.meta_value as string|null);
    if(total>CORE_READ_TOTAL_MAX_BYTES)return refuse();
    rows.push(Object.freeze(row as unknown as CorePostMetaRow));
  }
  return Object.freeze(rows);
}
