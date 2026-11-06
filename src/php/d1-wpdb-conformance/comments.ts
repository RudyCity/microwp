/**
 * Private query-native D1 proof for WordPress comments and commentmeta.
 * Fixed host SQL only; no raw SQL/table/scope/projection from PHP or HTTP.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export const COMMENT_POST_BATCH_MAX_IDS=16;
export const COMMENTMETA_BATCH_MAX_IDS=32;
export const COMMENT_MAX_ROWS=128;
export const COMMENTMETA_MAX_ROWS=256;
export const COMMENT_TEXT_MAX_BYTES=32*1024;
export const COMMENTMETA_VALUE_MAX_BYTES=8*1024;

const COMMENT_STRING_FIELDS=[
  "comment_author","comment_author_email","comment_author_url","comment_author_IP",
  "comment_date","comment_date_gmt","comment_content","comment_approved",
  "comment_agent","comment_type"
] as const;
const COMMENT_INT_FIELDS=[
  "comment_ID","comment_post_ID","comment_karma","comment_parent","user_id"
] as const;
const COMMENT_COLUMNS=[...COMMENT_INT_FIELDS,...COMMENT_STRING_FIELDS] as const;

export interface TrustedCommentConfig {
  readonly scope:{readonly column:string;readonly value:string};
  readonly capabilities:{
    readonly read:object;
    readonly insert:object;
    readonly metaRead:object;
  };
}
export type CommentInsert=Readonly<
  Record<typeof COMMENT_STRING_FIELDS[number],string>&
  Record<typeof COMMENT_INT_FIELDS[number],number>
>;
export interface CommentRow extends CommentInsert {}
export interface CommentCountRow {
  readonly comment_post_ID:number;
  readonly count:number;
}
export interface CommentMetaRow {
  readonly meta_id:number;
  readonly comment_id:number;
  readonly meta_key:string|null;
  readonly meta_value:string|null;
}
export interface CommentDatabase {prepare:D1Database["prepare"]}

const encoder=new TextEncoder();
function refuse():never{throw Error("Private WordPress comment D1 operation rejected");}
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
function ids(value:unknown,max:number):value is readonly number[]{
  if(!Array.isArray(value)||value.length<1||value.length>max)return false;
  for(let i=0;i<value.length;i++){
    if(!Object.hasOwn(value,i)||!integer(value[i],true))return false;
  }
  return new Set(value).size===value.length;
}
function quote(name:string):string{
  if(!validIdentifier(name))return refuse();
  return '"'+name+'"';
}
function exact(row:Record<string,unknown>,expected:readonly string[]):boolean{
  const a=Object.keys(row).sort(),b=[...expected].sort();
  return a.length===b.length&&a.every((key,i)=>key===b[i]);
}
function validConfig(config:unknown):config is TrustedCommentConfig{
  if(!config||typeof config!=="object"||Array.isArray(config))return false;
  const c=config as Record<string,unknown>,s=c.scope,abilities=c.capabilities;
  if(!s||typeof s!=="object"||Array.isArray(s)||
     !abilities||typeof abilities!=="object"||Array.isArray(abilities))return false;
  const scope=s as Record<string,unknown>,caps=abilities as Record<string,unknown>;
  return Object.keys(c).sort().join(",")==="capabilities,scope"&&
    Object.keys(scope).sort().join(",")==="column,value"&&
    Object.keys(caps).sort().join(",")==="insert,metaRead,read"&&
    validIdentifier(scope.column)&&
    ![...COMMENT_COLUMNS,"meta_id","comment_id","meta_key","meta_value"]
      .includes(scope.column as never)&&
    typeof scope.value==="string"&&scope.value.length>0&&
    !scope.value.includes("\u0000")&&encoder.encode(scope.value).byteLength<=191&&
    cap(caps.read)&&cap(caps.insert)&&cap(caps.metaRead)&&
    new Set([caps.read,caps.insert,caps.metaRead]).size===3;
}
function projection(name:string,max:number,nullable=false):string{
  const q=quote(name);
  if(nullable){
    return "CASE WHEN "+q+" IS NULL THEN NULL WHEN typeof("+q+
      ") = 'text' AND length(CAST("+q+" AS BLOB)) <= ? THEN "+q+
      " ELSE 0 END AS "+q;
  }
  return "CASE WHEN typeof("+q+") = 'text' AND length(CAST("+q+
    " AS BLOB)) <= ? THEN "+q+" ELSE NULL END AS "+q;
}
function validComment(row:Record<string,unknown>):row is Record<string,unknown>&CommentRow{
  if(!exact(row,COMMENT_COLUMNS))return false;
  for(const name of COMMENT_INT_FIELDS)if(!integer(row[name],name==="comment_ID"||name==="comment_post_ID"))return false;
  for(const name of COMMENT_STRING_FIELDS)if(!text(row[name],COMMENT_TEXT_MAX_BYTES))return false;
  return true;
}

export async function countPrivateApprovedCommentsByPostIds(
  postIds:readonly number[],approvedStates:readonly string[],
  config:TrustedCommentConfig,db:CommentDatabase,callerCapability:object
):Promise<readonly CommentCountRow[]>{
  if(!validConfig(config)||callerCapability!==config.capabilities.read||
     !cap(callerCapability)||!ids(postIds,COMMENT_POST_BATCH_MAX_IDS)||
     !Array.isArray(approvedStates)||approvedStates.length<1||approvedStates.length>4||
     approvedStates.some((state,i)=>!Object.hasOwn(approvedStates,i)||
       typeof state!=="string"||state.length===0||!text(state,20))||
     new Set(approvedStates).size!==approvedStates.length||
     !db||typeof db.prepare!=="function")return refuse();
  const posts=Object.freeze([...postIds]),states=Object.freeze([...approvedStates]);
  const sql='SELECT "comment_post_ID", COUNT(*) AS "count" FROM "wp_comments" WHERE '+
    quote(config.scope.column)+' = ? AND "comment_post_ID" IN ('+
    posts.map(()=>"?").join(", ")+') AND "comment_approved" IN ('+
    states.map(()=>"?").join(", ")+') GROUP BY "comment_post_ID" '+
    'ORDER BY "comment_post_ID" ASC LIMIT ?';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      config.scope.value,...posts,...states,posts.length+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>posts.length)return refuse();
  const wanted=new Set(posts),rows:CommentCountRow[]=[];
  let previous=0;
  for(const item of raw.results){
    if(!item||typeof item!=="object"||Array.isArray(item))return refuse();
    const row=item as Record<string,unknown>;
    if(!exact(row,["comment_post_ID","count"])||
       !integer(row.comment_post_ID,true)||!wanted.has(row.comment_post_ID as number)||
       !integer(row.count)||row.count===0||(row.comment_post_ID as number)<=previous)
      return refuse();
    previous=row.comment_post_ID as number;
    rows.push(Object.freeze({
      comment_post_ID:row.comment_post_ID as number,count:row.count as number
    }));
  }
  return Object.freeze(rows);
}

export async function readPrivateCommentsByPostIds(
  postIds:readonly number[],config:TrustedCommentConfig,db:CommentDatabase,
  callerCapability:object
):Promise<readonly CommentRow[]>{
  if(!validConfig(config)||callerCapability!==config.capabilities.read||
     !cap(callerCapability)||!ids(postIds,COMMENT_POST_BATCH_MAX_IDS)||
     !db||typeof db.prepare!=="function")return refuse();
  const posts=Object.freeze([...postIds]);
  const sql='SELECT '+
    COMMENT_INT_FIELDS.map(quote).join(", ")+", "+
    COMMENT_STRING_FIELDS.map(name=>projection(name,COMMENT_TEXT_MAX_BYTES)).join(", ")+
    ' FROM "wp_comments" WHERE '+quote(config.scope.column)+' = ? AND '+
    '"comment_post_ID" IN ('+posts.map(()=>"?").join(", ")+') '+
    'ORDER BY "comment_ID" ASC LIMIT ?';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      ...COMMENT_STRING_FIELDS.map(()=>COMMENT_TEXT_MAX_BYTES),
      config.scope.value,...posts,COMMENT_MAX_ROWS+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>COMMENT_MAX_ROWS)return refuse();
  const wanted=new Set(posts),rows:CommentRow[]=[];
  let previous=0,total=0;
  for(const item of raw.results){
    if(!item||typeof item!=="object"||Array.isArray(item))return refuse();
    const row=item as Record<string,unknown>;
    if(!validComment(row)||!wanted.has(row.comment_post_ID)||
       row.comment_ID<=previous)return refuse();
    previous=row.comment_ID;
    for(const name of COMMENT_STRING_FIELDS)
      total+=encoder.encode(row[name]).byteLength;
    if(total>256*1024)return refuse();
    rows.push(Object.freeze(row as unknown as CommentRow));
  }
  return Object.freeze(rows);
}

export async function insertPrivateComment(
  comment:CommentInsert,config:TrustedCommentConfig,db:CommentDatabase,
  callerCapability:object
):Promise<Readonly<{operation:"comment-insert";changed:0|1;queryCount:1}>>{
  if(!validConfig(config)||callerCapability!==config.capabilities.insert||
     !cap(callerCapability)||!comment||typeof comment!=="object"||
     Array.isArray(comment)||!exact(comment as unknown as Record<string,unknown>,COMMENT_COLUMNS)||
     !validComment(comment as unknown as Record<string,unknown>)||
     !db||typeof db.prepare!=="function")return refuse();
  const columns=[...COMMENT_INT_FIELDS,...COMMENT_STRING_FIELDS];
  const scope=quote(config.scope.column);
  const sql='INSERT INTO "wp_comments" ('+
    [scope,...columns.map(quote)].join(", ")+') SELECT '+
    Array.from({length:columns.length+1},()=>"?").join(", ")+
    ' WHERE EXISTS (SELECT 1 FROM "wp_posts" WHERE '+scope+
    ' = ? AND "ID" = ?)';
  let result:Awaited<ReturnType<D1PreparedStatement["run"]>>;
  try{
    result=await db.prepare(sql).bind(
      config.scope.value,
      ...columns.map(name=>(comment as unknown as Record<string,string|number>)[name]!),
      config.scope.value,comment.comment_post_ID
    ).run();
  }catch{return refuse();}
  const changes=result?.meta?.changes;
  if(!result||result.success!==true||!integer(changes)||changes>1)return refuse();
  return Object.freeze({
    operation:"comment-insert",changed:changes as 0|1,queryCount:1
  });
}

export async function readPrivateCommentMetaByCommentIds(
  commentIds:readonly number[],config:TrustedCommentConfig,db:CommentDatabase,
  callerCapability:object
):Promise<readonly CommentMetaRow[]>{
  if(!validConfig(config)||callerCapability!==config.capabilities.metaRead||
     !cap(callerCapability)||!ids(commentIds,COMMENTMETA_BATCH_MAX_IDS)||
     !db||typeof db.prepare!=="function")return refuse();
  const requested=Object.freeze([...commentIds]),wanted=new Set(requested);
  const sql='SELECT "meta_id", "comment_id", '+
    projection("meta_key",COMMENTMETA_VALUE_MAX_BYTES,true)+", "+
    projection("meta_value",COMMENTMETA_VALUE_MAX_BYTES,true)+
    ' FROM "wp_commentmeta" WHERE '+quote(config.scope.column)+
    ' = ? AND "comment_id" IN ('+requested.map(()=>"?").join(", ")+
    ') ORDER BY "meta_id" ASC LIMIT ?';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      COMMENTMETA_VALUE_MAX_BYTES,COMMENTMETA_VALUE_MAX_BYTES,
      config.scope.value,...requested,COMMENTMETA_MAX_ROWS+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>COMMENTMETA_MAX_ROWS)return refuse();
  const rows:CommentMetaRow[]=[];
  let previous=0,total=0;
  for(const item of raw.results){
    if(!item||typeof item!=="object"||Array.isArray(item))return refuse();
    const row=item as Record<string,unknown>;
    if(!exact(row,["meta_id","comment_id","meta_key","meta_value"])||
       !integer(row.meta_id,true)||!integer(row.comment_id,true)||
       !wanted.has(row.comment_id as number)||
       !text(row.meta_key,COMMENTMETA_VALUE_MAX_BYTES,true)||
       !text(row.meta_value,COMMENTMETA_VALUE_MAX_BYTES,true)||
       (row.meta_id as number)<=previous)return refuse();
    previous=row.meta_id as number;
    total+=(row.meta_key===null?0:encoder.encode(row.meta_key as string).byteLength)+
      (row.meta_value===null?0:encoder.encode(row.meta_value as string).byteLength);
    if(total>128*1024)return refuse();
    rows.push(Object.freeze(row as unknown as CommentMetaRow));
  }
  return Object.freeze(rows);
}
