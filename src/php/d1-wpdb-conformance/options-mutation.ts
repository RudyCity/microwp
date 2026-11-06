/**
 * Private, opt-in WordPress option write semantics on query-native D1.
 *
 * This is NOT an installed WordPress wpdb, PHP SQL translator, or public API.
 * A trusted host must own the D1 binding, site scope and distinct opaque
 * per-operation capabilities. Prepared, fixed SQL is the only execution path.
 *
 * The UPSERT requires a real UNIQUE(site_column, option_name) constraint in
 * SQLite: a missing constraint causes SQLite ON CONFLICT to reject the query.
 * DELETE uses an atomic D1 batch to detect duplicate keys before deleting.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export type OptionMutation =
  | {readonly op:"put";readonly name:string;readonly value:string;readonly autoload:string}
  | {readonly op:"delete";readonly name:string};

export interface TrustedOptionWriteConfig {
  readonly table:string;
  readonly scope:{readonly column:string;readonly value:string};
  readonly writeCapabilities:{readonly put:object;readonly delete:object};
}
export interface OptionWriteDatabase {
  prepare:D1Database["prepare"];
  batch:D1Database["batch"];
}
export type OptionWriteResult=Readonly<{
  operation:"put"|"delete";
  changed:0|1;
  queryCount:1|2;
}>;

export const OPTION_WRITE_NAME_MAX_BYTES=191;
export const OPTION_WRITE_VALUE_MAX_BYTES=2048;
export const OPTION_PUT_QUERY_COUNT=1;
export const OPTION_DELETE_QUERY_COUNT=2; // SQL statements in one atomic batch.
export const OPTION_DELETE_D1_API_CALLS=1; // One D1 batch() API invocation.
const AUTOLOAD_VALUES=new Set(["yes","no","on","off","auto-on","auto-off","auto"]);
const encoder=new TextEncoder();
const bytes=(text:string)=>encoder.encode(text).byteLength;
function refuse():never{throw new Error("Private WordPress D1 option write rejected");}
function acceptableString(value:unknown,limit:number):value is string{
  return typeof value==="string"&&value.length>0&&
    !value.includes("\u0000")&&bytes(value)<=limit;
}
function configValid(config:TrustedOptionWriteConfig):boolean{
  const s=config?.scope, caps=config?.writeCapabilities;
  return !!s&&!!caps&&validIdentifier(config.table)&&
    validIdentifier(s.column)&&
    !["option_name","option_value","autoload"].includes(s.column)&&
    acceptableString(s.value,191)&&
    typeof caps.put==="object"&&caps.put!==null&&!Array.isArray(caps.put)&&
    typeof caps.delete==="object"&&caps.delete!==null&&!Array.isArray(caps.delete)&&
    caps.put!==caps.delete;
}
function mutationValid(request:OptionMutation):boolean{
  if(!request||typeof request!=="object"||Array.isArray(request)||
     !acceptableString(request.name,OPTION_WRITE_NAME_MAX_BYTES))return false;
  if(request.op==="put"){
    return Object.keys(request).sort().join(",")==="autoload,name,op,value"&&
      typeof request.value==="string"&&bytes(request.value)<=OPTION_WRITE_VALUE_MAX_BYTES&&
      AUTOLOAD_VALUES.has(request.autoload);
  }
  if(request.op==="delete")return Object.keys(request).sort().join(",")==="name,op";
  return false;
}
function safeChanges(result:unknown):0|1{
  if(!result||typeof result!=="object"||Array.isArray(result))return refuse();
  const value=result as Record<string,unknown>;
  if(value.success!==true||!value.meta||typeof value.meta!=="object")return refuse();
  const meta=value.meta as Record<string,unknown>;
  if(meta.changes!==0&&meta.changes!==1)return refuse();
  return meta.changes;
}

/** Host authorization must precede every D1 prepare(), even for malformed SQL. */
export async function mutateTrustedWordPressOption(
  mutation:OptionMutation,config:TrustedOptionWriteConfig,
  db:OptionWriteDatabase,callerCapability:object
):Promise<OptionWriteResult>{
  if(!configValid(config)||!mutationValid(mutation)||
     !db||typeof db.prepare!=="function"||typeof db.batch!=="function"||
     !callerCapability||typeof callerCapability!=="object"||
     callerCapability!==config.writeCapabilities[mutation.op])return refuse();
  const table='"'+config.table+'"',site='"'+config.scope.column+'"';
  if(mutation.op==="put"){
    const sql='INSERT INTO '+table+' ('+
      site+', "option_name", "option_value", "autoload") VALUES (?, ?, ?, ?) '+
      'ON CONFLICT ('+site+', "option_name") DO UPDATE SET '+
      '"option_value" = excluded."option_value", "autoload" = excluded."autoload"';
    let answer:unknown;
    try{
      answer=await db.prepare(sql).bind(
        config.scope.value,mutation.name,mutation.value,mutation.autoload
      ).run();
    }catch{return refuse();}
    if(safeChanges(answer)!==1)return refuse();
    return Object.freeze({operation:"put",changed:1,queryCount:OPTION_PUT_QUERY_COUNT});
  }

  const predicate=site+' = ? AND "option_name" = ?';
  const sqlCount='SELECT COUNT(*) AS "matches" FROM '+table+' WHERE '+predicate;
  const sqlDelete='DELETE FROM '+table+' WHERE '+predicate+
    ' AND (SELECT COUNT(*) FROM '+table+' WHERE '+predicate+') = 1';
  let responses:Awaited<ReturnType<D1Database["batch"]>>;
  try{
    responses=await db.batch([
      db.prepare(sqlCount).bind(config.scope.value,mutation.name),
      db.prepare(sqlDelete).bind(
        config.scope.value,mutation.name,config.scope.value,mutation.name
      )
    ]);
  }catch{return refuse();}
  if(!Array.isArray(responses)||responses.length!==2||
     responses[0]?.success!==true||!Array.isArray(responses[0].results)||
     responses[0].results.length!==1)return refuse();
  const countRow=responses[0].results[0];
  if(!countRow||typeof countRow!=="object"||Array.isArray(countRow)||
     Object.keys(countRow).join(",")!=="matches")return refuse();
  const matches=(countRow as Record<string,unknown>).matches;
  if(matches!==0&&matches!==1)return refuse();
  const changed=safeChanges(responses[1]);
  if(changed!==matches)return refuse();
  return Object.freeze({operation:"delete",changed,queryCount:OPTION_DELETE_QUERY_COUNT});
}
