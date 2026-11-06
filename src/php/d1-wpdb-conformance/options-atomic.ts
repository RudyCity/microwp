/**
 * Transactional, read-only WordPress autoload options proof using D1.batch().
 *
 * Cloudflare D1 executes all statements in batch() in a single SQL
 * transaction. This differs from repeated independently dispatched SELECTs.
 * It is an EXPERIMENTAL trusted-host helper, not installed as WordPress wpdb.
 *
 * No source SQL, request-supplied site scope, or free-form D1 queries are
 * accepted. Every full read is exactly one D1 batch with bounded results.
 */
import {
  MAX_RESPONSE_BYTES, MAX_ROWS, validIdentifier
} from "../d1-protocol/protocol";
import {
  MAX_AUTOLOAD_OPTIONS, MAX_AUTOLOAD_TOTAL_BYTES
} from "./options-complete";
import {
  translateWordPressAutoloadOptions, type AutoloadOptionsConfig
} from "./options-autoload";

export const MAX_ATOMIC_OPTION_VALUE_BYTES = 2048;
export const MAX_ATOMIC_OPTION_NAME_BYTES = 191;
export const ATOMIC_AUTOLOAD_BATCH_STATEMENTS = MAX_AUTOLOAD_OPTIONS / MAX_ROWS + 1;
// Cloudflare D1 Free counts one batch() API call toward the 50-query-per-
// Worker-invocation subrequest ceiling, not each SQL statement in the batch.
export const ATOMIC_AUTOLOAD_D1_API_CALLS = 1;

export interface TrustedAtomicAutoloadConfig extends AutoloadOptionsConfig {
  /** Private host-owned tenant identity; never accepted from WordPress PHP/HTTP. */
  readonly scope: {readonly column:string;readonly value:string};
}
export interface AtomicAutoloadDatabase {
  prepare: D1Database["prepare"];
  batch: D1Database["batch"];
}
export type AtomicAutoloadOptions = Readonly<Record<string,string>>;

function refuse(): never {
  throw new Error("Atomic WordPress D1 autoload read rejected");
}
const encoder=new TextEncoder();
function size(text:string):number{return encoder.encode(text).byteLength;}
function before(a:string,b:string):boolean{
  const x=encoder.encode(a),y=encoder.encode(b);
  for(let i=0;i<Math.min(x.length,y.length);i++){
    if(x[i]!==y[i])return x[i]<y[i];
  }
  return x.length<y.length;
}
function quoted(value:string):string{
  if(!validIdentifier(value))return refuse();
  return '"'+value+'"';
}

/**
 * Single transactional D1 batch reads pages [0..9] and one overflow page.
 * If 500 rows are returned, the overflow page must be empty.
 *
 * This guarantees a single SQLite transaction for a batch of prepared reads
 * per Cloudflare's D1 Database API. It does NOT establish WordPress wpdb
 * compatibility, query count scalability or Cloudflare Free CPU fitness.
 */
export async function loadAtomicWordPressAutoloadOptions(
  originalQuery:string,
  config:TrustedAtomicAutoloadConfig,
  db:AtomicAutoloadDatabase
):Promise<AtomicAutoloadOptions>{
  if(!config||!config.scope||
     !validIdentifier(config.table)||
     !validIdentifier(config.scope.column)||
     ["option_name","option_value","autoload"].includes(config.scope.column)||
     typeof config.scope.value!=="string"||
     !config.scope.value||config.scope.value.includes("\u0000")||
     size(config.scope.value)>191||
     !db||typeof db.prepare!=="function"||typeof db.batch!=="function"){
    return refuse();
  }
  const canonical=translateWordPressAutoloadOptions(
    originalQuery,"autoload-atomic",config,0
  );
  const values=canonical.whereIn?.values;
  if(!values||values.length<1||values.length>4||
     values.some(value=>typeof value!=="string"))return refuse();

  // SQL identifiers derive exclusively from validated, trusted host config.
  // Limit each returned option value at the SQL source: D1 never materializes
  // an unbounded option_value in the returned batch results.
  const sql='SELECT '+
    'CASE WHEN typeof("option_name") = \'text\' AND '+
    'length(CAST("option_name" AS BLOB)) <= ? '+
    'THEN "option_name" ELSE NULL END AS "option_name", '+
    'CASE WHEN typeof("option_value") = \'text\' AND '+
    'length(CAST("option_value" AS BLOB)) <= ? '+
    'THEN "option_value" ELSE NULL END AS "option_value" '+
    'FROM '+quoted(config.table)+
    ' WHERE "autoload" IN ('+values.map(()=>'?').join(', ')+') '+
    'AND '+quoted(config.scope.column)+' = ? '+
    'ORDER BY "option_name" COLLATE BINARY ASC LIMIT ? OFFSET ?';

  const statements=[];
  try{
    for(let page=0;page<ATOMIC_AUTOLOAD_BATCH_STATEMENTS;page++){
      const stmt=db.prepare(sql).bind(
        MAX_ATOMIC_OPTION_NAME_BYTES,MAX_ATOMIC_OPTION_VALUE_BYTES,
        ...values,config.scope.value,MAX_ROWS,page*MAX_ROWS
      );
      statements.push(stmt);
    }
  }catch{return refuse();}
  let results:Awaited<ReturnType<D1Database["batch"]>>;
  try{
    // D1 batch provides transactionally consistent results; never split into
    // multiple .all() calls or independent batch() calls for this operation.
    results=await db.batch(statements);
  }catch{return refuse();}
  if(!Array.isArray(results)||results.length!==ATOMIC_AUTOLOAD_BATCH_STATEMENTS)
    return refuse();

  const options=Object.create(null) as Record<string,string>;
  let previousName:string|undefined;
  let bytes=0,count=0;
  let shortPageSeen=false;
  for(let page=0;page<results.length;page++){
    const result=results[page];
    if(!result||result.success!==true||!Array.isArray(result.results)||
       result.results.length>MAX_ROWS)return refuse();
    const rows=result.results;
    if(size(JSON.stringify(rows))>MAX_RESPONSE_BYTES)return refuse();

    if(page===ATOMIC_AUTOLOAD_BATCH_STATEMENTS-1){
      if(rows.length>0)return refuse(); // Explicit overflow detection.
      break;
    }
    if(shortPageSeen&&rows.length!==0)return refuse();
    for(const raw of rows){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))return refuse();
      if(Object.keys(raw).sort().join(",")!=="option_name,option_value")
        return refuse();
      const row=raw as Record<string,unknown>;
      const name=row.option_name, value=row.option_value;
      if(typeof name!=="string"||typeof value!=="string"||
         !name||name.includes("\u0000")||
         size(name)>MAX_ATOMIC_OPTION_NAME_BYTES||
         size(value)>MAX_ATOMIC_OPTION_VALUE_BYTES||
         (previousName!==undefined&&!before(previousName,name)))
        return refuse();
      previousName=name;
      bytes+=size(name)+size(value);
      if(bytes>MAX_AUTOLOAD_TOTAL_BYTES||count>=MAX_AUTOLOAD_OPTIONS)
        return refuse();
      options[name]=value;
      count++;
    }
    if(rows.length<MAX_ROWS)shortPageSeen=true;
  }
  return Object.freeze(options);
}
