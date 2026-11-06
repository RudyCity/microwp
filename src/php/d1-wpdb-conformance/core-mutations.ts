/**
 * Private query-native D1 write proof for WordPress posts and postmeta.
 *
 * Non-installed and host-only. No raw SQL, table, site identity, arbitrary
 * column names or WHERE fragments are accepted from WordPress/PHP/HTTP.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export const POST_WRITE_TEXT_MAX_BYTES=32*1024;
export const POSTMETA_WRITE_VALUE_MAX_BYTES=8*1024;
export const POSTMETA_WRITE_KEY_MAX_BYTES=255;

const POST_TEXT_FIELDS=[
  "post_date","post_date_gmt","post_content","post_title","post_excerpt",
  "post_status","comment_status","ping_status","post_password","post_name",
  "to_ping","pinged","post_modified","post_modified_gmt",
  "post_content_filtered","guid","post_type","post_mime_type"
] as const;
const POST_INT_FIELDS=[
  "ID","post_author","post_parent","menu_order","comment_count"
] as const;
const PATCH_FIELDS=[
  "post_author","post_date","post_date_gmt","post_content","post_title",
  "post_excerpt","post_status","comment_status","ping_status","post_password",
  "post_name","to_ping","pinged","post_modified","post_modified_gmt",
  "post_content_filtered","post_parent","guid","menu_order","post_type",
  "post_mime_type","comment_count"
] as const;

type PostTextField=typeof POST_TEXT_FIELDS[number];
type PostIntField=typeof POST_INT_FIELDS[number];
export type CorePostInsert=Readonly<Record<PostTextField,string>&Record<PostIntField,number>>;
export type CorePostPatch=Readonly<Partial<Omit<CorePostInsert,"ID">>>;
export interface PostMetaInsert {
  readonly meta_id:number;
  readonly post_id:number;
  readonly meta_key:string|null;
  readonly meta_value:string|null;
}
export interface PostMetaPatch {
  readonly meta_key?:string|null;
  readonly meta_value?:string|null;
}
export interface TrustedCoreWriteConfig {
  readonly scope:{readonly column:string;readonly value:string};
  readonly capabilities:{
    readonly postInsert:object;
    readonly postUpdate:object;
    readonly postMetaInsert:object;
    readonly postMetaUpdate:object;
    readonly postMetaDelete:object;
  };
}
export interface CoreWriteDatabase {prepare:D1Database["prepare"]}
export interface CoreWriteResult {
  readonly operation:
    |"post-insert"|"post-update"
    |"postmeta-insert"|"postmeta-update"|"postmeta-delete";
  readonly changed:0|1;
  readonly queryCount:1;
}

const encoder=new TextEncoder();
function refuse():never{throw Error("Private WordPress core D1 write rejected");}
function cap(value:unknown):value is object{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
function integer(value:unknown,positive=false):value is number{
  return typeof value==="number"&&Number.isSafeInteger(value)&&
    (positive?value>0:value>=0);
}
function text(value:unknown,max:number,nullable=false):value is string|null{
  if(value===null)return nullable;
  return typeof value==="string"&&!value.includes("\u0000")&&
    encoder.encode(value).byteLength<=max;
}
function exactKeys(value:Record<string,unknown>,expected:readonly string[]):boolean{
  const a=Object.keys(value).sort(),b=[...expected].sort();
  return a.length===b.length&&a.every((key,i)=>key===b[i]);
}
function quote(name:string):string{
  if(!validIdentifier(name))return refuse();
  return '"'+name+'"';
}
function validConfig(config:unknown):config is TrustedCoreWriteConfig{
  if(!config||typeof config!=="object"||Array.isArray(config))return false;
  const c=config as Record<string,unknown>,s=c.scope,caps=c.capabilities;
  if(!s||typeof s!=="object"||Array.isArray(s)||
     !caps||typeof caps!=="object"||Array.isArray(caps))return false;
  const scope=s as Record<string,unknown>,abilities=caps as Record<string,unknown>;
  const capNames=["postInsert","postMetaDelete","postMetaInsert","postMetaUpdate","postUpdate"];
  return Object.keys(c).sort().join(",")==="capabilities,scope"&&
    Object.keys(scope).sort().join(",")==="column,value"&&
    Object.keys(abilities).sort().join(",")===capNames.join(",")&&
    validIdentifier(scope.column)&&
    ![...POST_TEXT_FIELDS,...POST_INT_FIELDS,"meta_id","post_id","meta_key","meta_value"]
      .includes(scope.column as never)&&
    typeof scope.value==="string"&&scope.value.length>0&&
    !scope.value.includes("\u0000")&&encoder.encode(scope.value).byteLength<=191&&
    capNames.every(name=>cap(abilities[name]))&&
    new Set(capNames.map(name=>abilities[name])).size===capNames.length;
}
function postValueValid(name:string,value:unknown):boolean{
  if((POST_INT_FIELDS as readonly string[]).includes(name))
    return integer(value,name==="ID");
  if((POST_TEXT_FIELDS as readonly string[]).includes(name))
    return text(value,POST_WRITE_TEXT_MAX_BYTES);
  return false;
}
function changed(raw:unknown):0|1{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return refuse();
  const result=raw as {success?:unknown;meta?:{changes?:unknown}};
  if(result.success!==true||!result.meta||
     !integer(result.meta.changes)||result.meta.changes>1)return refuse();
  return result.meta.changes as 0|1;
}
async function run(db:CoreWriteDatabase,sql:string,args:(string|number|null)[]):Promise<0|1>{
  try{return changed(await db.prepare(sql).bind(...args).run());}
  catch{return refuse();}
}

export async function insertPrivateCorePost(
  post:CorePostInsert,config:TrustedCoreWriteConfig,db:CoreWriteDatabase,
  callerCapability:object
):Promise<CoreWriteResult>{
  if(!validConfig(config)||callerCapability!==config.capabilities.postInsert||
     !cap(callerCapability)||!post||typeof post!=="object"||Array.isArray(post)||
     !exactKeys(post as unknown as Record<string,unknown>,
       [...POST_INT_FIELDS,...POST_TEXT_FIELDS])||
     ![...POST_INT_FIELDS,...POST_TEXT_FIELDS].every(name=>
       postValueValid(name,(post as unknown as Record<string,unknown>)[name]))||
     !db||typeof db.prepare!=="function")return refuse();
  const columns=[...POST_INT_FIELDS,...POST_TEXT_FIELDS];
  const sql="INSERT INTO \"wp_posts\" ("+
    [quote(config.scope.column),...columns.map(quote)].join(", ")+
    ") VALUES ("+Array.from({length:columns.length+1},()=>"?").join(", ")+")";
  const did=await run(db,sql,[
    config.scope.value,...columns.map(name=>
      (post as unknown as Record<string,string|number>)[name]!)
  ]);
  if(did!==1)return refuse();
  return Object.freeze({operation:"post-insert",changed:1,queryCount:1});
}

export async function updatePrivateCorePost(
  id:number,patch:CorePostPatch,config:TrustedCoreWriteConfig,db:CoreWriteDatabase,
  callerCapability:object
):Promise<CoreWriteResult>{
  if(!validConfig(config)||callerCapability!==config.capabilities.postUpdate||
     !cap(callerCapability)||!integer(id,true)||
     !patch||typeof patch!=="object"||Array.isArray(patch)||
     !db||typeof db.prepare!=="function")return refuse();
  const names=Object.keys(patch);
  if(names.length<1||names.length>8||new Set(names).size!==names.length||
     names.some(name=>!(PATCH_FIELDS as readonly string[]).includes(name)||
       !postValueValid(name,(patch as Record<string,unknown>)[name])))
    return refuse();
  const sql="UPDATE \"wp_posts\" SET "+
    names.map(name=>quote(name)+" = ?").join(", ")+" WHERE "+
    quote(config.scope.column)+" = ? AND \"ID\" = ?";
  const did=await run(db,sql,[
    ...names.map(name=>(patch as Record<string,string|number>)[name]!),
    config.scope.value,id
  ]);
  return Object.freeze({operation:"post-update",changed:did,queryCount:1});
}

export async function insertPrivatePostMeta(
  meta:PostMetaInsert,config:TrustedCoreWriteConfig,db:CoreWriteDatabase,
  callerCapability:object
):Promise<CoreWriteResult>{
  if(!validConfig(config)||callerCapability!==config.capabilities.postMetaInsert||
     !cap(callerCapability)||!meta||typeof meta!=="object"||Array.isArray(meta)||
     !exactKeys(meta as unknown as Record<string,unknown>,
       ["meta_id","post_id","meta_key","meta_value"])||
     !integer(meta.meta_id,true)||!integer(meta.post_id,true)||
     !text(meta.meta_key,POSTMETA_WRITE_KEY_MAX_BYTES,true)||
     !text(meta.meta_value,POSTMETA_WRITE_VALUE_MAX_BYTES,true)||
     !db||typeof db.prepare!=="function")return refuse();
  // INSERT ... SELECT binds parent existence to the same trusted site in one
  // statement. A foreign/missing post becomes a clean 0-row no-op.
  const scope=quote(config.scope.column);
  const sql='INSERT INTO "wp_postmeta" ('+scope+
    ',"meta_id","post_id","meta_key","meta_value") '+
    'SELECT ?, ?, ?, ?, ? WHERE EXISTS ('+
    'SELECT 1 FROM "wp_posts" WHERE '+scope+' = ? AND "ID" = ?)';
  const did=await run(db,sql,[
    config.scope.value,meta.meta_id,meta.post_id,meta.meta_key,meta.meta_value,
    config.scope.value,meta.post_id
  ]);
  return Object.freeze({operation:"postmeta-insert",changed:did,queryCount:1});
}

export async function updatePrivatePostMeta(
  metaId:number,patch:PostMetaPatch,config:TrustedCoreWriteConfig,
  db:CoreWriteDatabase,callerCapability:object
):Promise<CoreWriteResult>{
  if(!validConfig(config)||callerCapability!==config.capabilities.postMetaUpdate||
     !cap(callerCapability)||!integer(metaId,true)||
     !patch||typeof patch!=="object"||Array.isArray(patch)||
     !db||typeof db.prepare!=="function")return refuse();
  const names=Object.keys(patch);
  if(names.length<1||names.length>2||
     names.some(name=>!["meta_key","meta_value"].includes(name))||
     ("meta_key" in patch&&!text(patch.meta_key,POSTMETA_WRITE_KEY_MAX_BYTES,true))||
     ("meta_value" in patch&&!text(patch.meta_value,POSTMETA_WRITE_VALUE_MAX_BYTES,true)))
    return refuse();
  const sql='UPDATE "wp_postmeta" SET '+
    names.map(name=>quote(name)+" = ?").join(", ")+" WHERE "+
    quote(config.scope.column)+' = ? AND "meta_id" = ?';
  const did=await run(db,sql,[
    ...names.map(name=>(patch as Record<string,string|null>)[name]!),
    config.scope.value,metaId
  ]);
  return Object.freeze({operation:"postmeta-update",changed:did,queryCount:1});
}

export async function deletePrivatePostMeta(
  metaId:number,config:TrustedCoreWriteConfig,db:CoreWriteDatabase,
  callerCapability:object
):Promise<CoreWriteResult>{
  if(!validConfig(config)||callerCapability!==config.capabilities.postMetaDelete||
     !cap(callerCapability)||!integer(metaId,true)||
     !db||typeof db.prepare!=="function")return refuse();
  const sql='DELETE FROM "wp_postmeta" WHERE '+
    quote(config.scope.column)+' = ? AND "meta_id" = ?';
  const did=await run(db,sql,[config.scope.value,metaId]);
  return Object.freeze({operation:"postmeta-delete",changed:did,queryCount:1});
}
