/**
 * Private query-native D1 proof for WordPress user authentication and usermeta.
 *
 * Sensitive: password hashes are returned ONLY to an explicit host-owned auth
 * capability. No HTTP/public route, logging, raw SQL, table or scope input.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export const USER_LOGIN_MAX_BYTES=60;
export const USER_PASS_MAX_BYTES=255;
export const USERMETA_BATCH_MAX_IDS=32;
export const USERMETA_MAX_ROWS=256;
export const USERMETA_VALUE_MAX_BYTES=8*1024;
export const USER_READ_TOTAL_MAX_BYTES=128*1024;

export interface TrustedUserReadConfig {
  readonly scope:{readonly column:string;readonly value:string};
  readonly authCapability:object;
  readonly userMetaCapability:object;
}
export interface PrivateUserAuthRow {
  readonly ID:number;
  readonly user_login:string;
  readonly user_pass:string;
  readonly user_status:number;
}
export interface PrivateUserMetaRow {
  readonly umeta_id:number;
  readonly user_id:number;
  readonly meta_key:string|null;
  readonly meta_value:string|null;
}
export interface UserReadDatabase {prepare:D1Database["prepare"]}

const encoder=new TextEncoder();
const AUTH_COLUMNS=["ID","user_login","user_pass","user_status"] as const;
const META_COLUMNS=["umeta_id","user_id","meta_key","meta_value"] as const;
function refuse():never{throw Error("Private WordPress user D1 read rejected");}
function capability(value:unknown):value is object{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
function utf8(value:string):number{return encoder.encode(value).byteLength;}
function boundedString(value:unknown,max:number,empty=false):value is string{
  return typeof value==="string"&&!value.includes("\u0000")&&
    (empty||value.length>0)&&utf8(value)<=max;
}
function boundedNullable(value:unknown,max:number):value is string|null{
  return value===null||boundedString(value,max,true);
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
function validConfig(config:unknown):config is TrustedUserReadConfig{
  if(!config||typeof config!=="object"||Array.isArray(config))return false;
  const c=config as Record<string,unknown>;
  const s=c.scope;
  if(!s||typeof s!=="object"||Array.isArray(s))return false;
  const scope=s as Record<string,unknown>;
  return Object.keys(c).sort().join(",")==="authCapability,scope,userMetaCapability"&&
    Object.keys(scope).sort().join(",")==="column,value"&&
    validIdentifier(scope.column)&&
    !AUTH_COLUMNS.includes(scope.column as never)&&
    !META_COLUMNS.includes(scope.column as never)&&
    typeof scope.value==="string"&&scope.value.length>0&&
    !scope.value.includes("\u0000")&&utf8(scope.value)<=191&&
    capability(c.authCapability)&&capability(c.userMetaCapability)&&
    c.authCapability!==c.userMetaCapability;
}
function quote(name:string):string{
  if(!validIdentifier(name))return refuse();
  return '"'+name+'"';
}
function nullableProjection(name:string,max:number):string{
  const q=quote(name);
  return "CASE WHEN "+q+" IS NULL THEN NULL WHEN typeof("+q+
    ") = 'text' AND length(CAST("+q+" AS BLOB)) <= ? THEN "+q+
    " ELSE 0 END AS "+q;
}
function textProjection(name:string,max:number):string{
  const q=quote(name);
  return "CASE WHEN typeof("+q+") = 'text' AND length(CAST("+q+
    " AS BLOB)) <= ? THEN "+q+" ELSE NULL END AS "+q;
}
function exactKeys(row:Record<string,unknown>,expected:readonly string[]):boolean{
  const left=Object.keys(row).sort(),right=[...expected].sort();
  return left.length===right.length&&left.every((key,i)=>key===right[i]);
}

/**
 * Minimal auth lookup only. The password hash must never cross a public HTTP
 * boundary; this helper is intended for an in-process WordPress auth adapter.
 */
export async function readPrivateUserAuthByLogin(
  login:string,config:TrustedUserReadConfig,db:UserReadDatabase,
  callerCapability:object
):Promise<PrivateUserAuthRow|null>{
  if(!validConfig(config)||callerCapability!==config.authCapability||
     !capability(callerCapability)||!boundedString(login,USER_LOGIN_MAX_BYTES)||
     !db||typeof db.prepare!=="function")return refuse();
  const sql='SELECT "ID", '+textProjection("user_login",USER_LOGIN_MAX_BYTES)+
    ', '+textProjection("user_pass",USER_PASS_MAX_BYTES)+
    ', "user_status" FROM "wp_users" WHERE '+quote(config.scope.column)+
    ' = ? AND "user_login" = ? LIMIT 2';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      USER_LOGIN_MAX_BYTES,USER_PASS_MAX_BYTES,config.scope.value,login
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>1)return refuse();
  if(raw.results.length===0)return null;
  const row=raw.results[0];
  if(!row||typeof row!=="object"||Array.isArray(row))return refuse();
  const value=row as Record<string,unknown>;
  if(!exactKeys(value,AUTH_COLUMNS)||!integer(value.ID)||value.ID===0||
     !boundedString(value.user_login,USER_LOGIN_MAX_BYTES)||
     !boundedString(value.user_pass,USER_PASS_MAX_BYTES)||
     !integer(value.user_status)||value.user_login!==login)return refuse();
  return Object.freeze(value as unknown as PrivateUserAuthRow);
}

/**
 * Mirrors the structural usermeta cache pattern: user_id IN (...) ORDER BY
 * umeta_id, with a hard overflow witness and bounded nullable values.
 */
export async function readPrivateUserMetaByUserIds(
  ids:readonly number[],config:TrustedUserReadConfig,db:UserReadDatabase,
  callerCapability:object
):Promise<readonly PrivateUserMetaRow[]>{
  if(!validConfig(config)||callerCapability!==config.userMetaCapability||
     !capability(callerCapability)||!validIds(ids,USERMETA_BATCH_MAX_IDS)||
     !db||typeof db.prepare!=="function")return refuse();
  const requested=Object.freeze([...ids]),wanted=new Set(requested);
  const sql='SELECT "umeta_id", "user_id", '+
    nullableProjection("meta_key",USERMETA_VALUE_MAX_BYTES)+', '+
    nullableProjection("meta_value",USERMETA_VALUE_MAX_BYTES)+
    ' FROM "wp_usermeta" WHERE '+quote(config.scope.column)+' = ? AND "user_id" IN ('+
    requested.map(()=>"?").join(", ")+
    ') ORDER BY "umeta_id" ASC LIMIT ?';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      USERMETA_VALUE_MAX_BYTES,USERMETA_VALUE_MAX_BYTES,
      config.scope.value,...requested,USERMETA_MAX_ROWS+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>USERMETA_MAX_ROWS)return refuse();
  const rows:PrivateUserMetaRow[]=[];
  let previous=0,total=0;
  for(const item of raw.results){
    if(!item||typeof item!=="object"||Array.isArray(item))return refuse();
    const row=item as Record<string,unknown>;
    if(!exactKeys(row,META_COLUMNS)||!integer(row.umeta_id)||row.umeta_id===0||
       !integer(row.user_id)||row.user_id===0||!wanted.has(row.user_id)||
       !boundedNullable(row.meta_key,USERMETA_VALUE_MAX_BYTES)||
       !boundedNullable(row.meta_value,USERMETA_VALUE_MAX_BYTES)||
       (row.umeta_id as number)<=previous)return refuse();
    previous=row.umeta_id as number;
    total+=(row.meta_key===null?0:utf8(row.meta_key as string))+
      (row.meta_value===null?0:utf8(row.meta_value as string));
    if(total>USER_READ_TOTAL_MAX_BYTES)return refuse();
    rows.push(Object.freeze(row as unknown as PrivateUserMetaRow));
  }
  return Object.freeze(rows);
}
