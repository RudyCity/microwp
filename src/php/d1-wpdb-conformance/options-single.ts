/**
 * Single-statement, site-scoped WordPress 7.1.4 autoload options D1 proof.
 *
 * One SQLite SELECT sees one statement snapshot and costs one D1 query,
 * unlike the eleven-statement transactional batch proof. This helper is
 * NEVER installed as WordPress wpdb or exposed to an HTTP caller.
 *
 * Host-owned table and site identity are mandatory; WordPress-supplied SQL
 * must match the pinned, strictly parsed autoload query.
 */
import {validIdentifier} from "../d1-protocol/protocol";
import {MAX_AUTOLOAD_OPTIONS,MAX_AUTOLOAD_TOTAL_BYTES} from "./options-complete";
import {translateWordPressAutoloadOptions} from "./options-autoload";
import {
  MAX_ATOMIC_OPTION_NAME_BYTES,MAX_ATOMIC_OPTION_VALUE_BYTES,
  type TrustedAtomicAutoloadConfig,type AtomicAutoloadOptions
} from "./options-atomic";

export const SINGLE_AUTOLOAD_D1_QUERIES=1;
export const SINGLE_AUTOLOAD_ROW_LIMIT=MAX_AUTOLOAD_OPTIONS+1;

const encoder=new TextEncoder();
function utf8Bytes(value:string):Uint8Array{return encoder.encode(value);}
function validScope(config:TrustedAtomicAutoloadConfig):boolean{
  return !!config&&!!config.scope&&
    validIdentifier(config.table)&&validIdentifier(config.scope.column)&&
    !["option_name","option_value","autoload"].includes(config.scope.column)&&
    typeof config.scope.value==="string"&&config.scope.value.length>0&&
    !config.scope.value.includes("\u0000")&&
    utf8Bytes(config.scope.value).byteLength<=191;
}
function before(left:Uint8Array,right:Uint8Array):boolean{
  for(let index=0;index<Math.min(left.length,right.length);index++){
    if(left[index]!==right[index])return left[index]<right[index];
  }
  return left.length<right.length;
}
function refuse():never{
  throw new Error("Single-query WordPress D1 autoload read rejected");
}

/**
 * Reads at most 501 rows with one bound SELECT. The 501st row is an explicit
 * overflow witness; it is never returned as a partial WordPress options map.
 * SQL-side CASE expressions avoid returning unbounded value blobs from D1.
 */
export async function loadSingleWordPressAutoloadOptions(
  originalQuery:string,
  config:TrustedAtomicAutoloadConfig,
  db:Pick<D1Database,"prepare">
):Promise<AtomicAutoloadOptions>{
  if(!validScope(config)||!db||typeof db.prepare!=="function")return refuse();
  // Validate all SQL BEFORE the D1 binding is touched. Only fixed autoload
  // literals can reach the prepared, host-constructed single SELECT.
  let values:readonly (string|number)[];
  try{
    const message=translateWordPressAutoloadOptions(
      originalQuery,"autoload-single",config,0
    );
    values=message.whereIn?.values??[];
  }catch{return refuse();}
  if(values.length<1||values.length>4||values.some(v=>typeof v!=="string"))
    return refuse();

  const quotedTable='"'+config.table+'"';
  const quotedScope='"'+config.scope.column+'"';
  const sql=
    'SELECT CASE WHEN typeof("option_name") = \x27text\x27 AND '+
    'length(CAST("option_name" AS BLOB)) <= ? '+
    'THEN "option_name" ELSE NULL END AS "option_name", '+
    'CASE WHEN typeof("option_value") = \x27text\x27 AND '+
    'length(CAST("option_value" AS BLOB)) <= ? '+
    'THEN "option_value" ELSE NULL END AS "option_value" '+
    'FROM '+quotedTable+' WHERE "autoload" IN ('+
    values.map(()=>'?').join(', ')+') AND '+quotedScope+' = ? '+
    'ORDER BY "option_name" COLLATE BINARY ASC LIMIT ?';
  let result:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    result=await db.prepare(sql).bind(
      MAX_ATOMIC_OPTION_NAME_BYTES,MAX_ATOMIC_OPTION_VALUE_BYTES,
      ...values,config.scope.value,SINGLE_AUTOLOAD_ROW_LIMIT
    ).all();
  }catch{return refuse();}
  if(!result||result.success!==true||!Array.isArray(result.results)||
      result.results.length>SINGLE_AUTOLOAD_ROW_LIMIT||
      result.results.length>MAX_AUTOLOAD_OPTIONS)
    return refuse();

  const options=Object.create(null) as Record<string,string>;
  let previous:Uint8Array|undefined;
  let totalBytes=0;
  for(const raw of result.results){
    if(!raw||typeof raw!=="object"||Array.isArray(raw)||
        Object.keys(raw).sort().join(",")!=="option_name,option_value")
      return refuse();
    const row=raw as Record<string,unknown>;
    if(typeof row.option_name!=="string"||typeof row.option_value!=="string"||
        !row.option_name||row.option_name.includes("\u0000"))
      return refuse();
    const name=utf8Bytes(row.option_name),value=utf8Bytes(row.option_value);
    if(name.byteLength>MAX_ATOMIC_OPTION_NAME_BYTES||
        value.byteLength>MAX_ATOMIC_OPTION_VALUE_BYTES||
        (previous!==undefined&&!before(previous,name)))
      return refuse();
    previous=name;
    totalBytes+=name.byteLength+value.byteLength;
    if(totalBytes>MAX_AUTOLOAD_TOTAL_BYTES)return refuse();
    options[row.option_name]=row.option_value;
  }
  return Object.freeze(options);
}
