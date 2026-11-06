/**
 * Private, host-only WordPress option store research for native D1.
 *
 * NOT an installed wpdb implementation or public HTTP handler. The trusted
 * creator owns the table, site scope, and independent opaque capabilities.
 * Every SELECT is prepared and validates complete response shape. The budget
 * accounts only for operations performed through THIS store instance; the
 * host must account separately for unrelated D1 calls in the invocation.
 */
import {validIdentifier} from "../d1-protocol/protocol";
import {loadSingleWordPressAutoloadOptions} from "./options-single";
import {
  mutateTrustedWordPressOption,
  OPTION_WRITE_NAME_MAX_BYTES,OPTION_WRITE_VALUE_MAX_BYTES,
  type TrustedOptionWriteConfig,type OptionWriteDatabase,
  type OptionWriteResult
} from "./options-mutation";

export const OPTIONS_STORE_MAX_QUERIES=50;
export const GET_OPTION_QUERY_COST=1;
export const ALL_OPTIONS_QUERY_COST=1;
export const WORDPRESS_AUTOLOAD_QUERY=
  "SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";

export type PrivateOptionStoreConfig=TrustedOptionWriteConfig&{
  readonly readCapability:object;
};
export interface OptionReadResult{
  readonly found:boolean;
  readonly value:string|null;
  readonly queryCount:1;
}
export interface PrivateOptionStore{
  get(name:string,caller:object):Promise<OptionReadResult>;
  all(caller:object):Promise<Readonly<Record<string,string>>>;
  put(name:string,value:string,autoload:string,caller:object):Promise<OptionWriteResult>;
  delete(name:string,caller:object):Promise<OptionWriteResult>;
  readonly usedQueries:number;
  readonly remainingQueries:number;
}
const encoder=new TextEncoder();
function refuse():never{throw new Error("Private D1 WordPress option store rejected");}
function stringWithin(value:unknown,max:number,allowEmpty=false):value is string{
  return typeof value==="string"&&
    (allowEmpty||value.length>0)&&
    !value.includes("\u0000")&&encoder.encode(value).byteLength<=max;
}
function capability(value:unknown):value is object{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}

/**
 * Site scope and capability identities are copied once, never read from
 * caller-mutable configuration after construction. Create only inside a
 * trusted invocation; do not share between independent HTTP requests.
 */
export function createPrivateWordPressOptionStore(
  config:PrivateOptionStoreConfig,
  db:OptionWriteDatabase
):PrivateOptionStore{
  if(!config||!config.scope||!config.writeCapabilities||
     !validIdentifier(config.table)||config.table!=="wp_options"||
     !validIdentifier(config.scope.column)||
     ["option_name","option_value","autoload"].includes(config.scope.column)||
     !stringWithin(config.scope.value,191)||
     !capability(config.readCapability)||
     !capability(config.writeCapabilities.put)||
     !capability(config.writeCapabilities.delete)||
     new Set([config.readCapability,config.writeCapabilities.put,config.writeCapabilities.delete]).size!==3||
     !db||typeof db.prepare!=="function"||typeof db.batch!=="function")return refuse();

  const readCap=config.readCapability;
  const writeConfig:TrustedOptionWriteConfig=Object.freeze({
    table:config.table,
    scope:Object.freeze({column:config.scope.column,value:config.scope.value}),
    writeCapabilities:Object.freeze({
      put:config.writeCapabilities.put,delete:config.writeCapabilities.delete
    })
  });
  let used=0;
  const authorize=(caller:unknown,required:object)=>{
    if(!capability(caller)||caller!==required)return refuse();
  };
  const consume=(cost:number)=>{
    if(!Number.isSafeInteger(cost)||cost<1||used+cost>OPTIONS_STORE_MAX_QUERIES)
      return refuse();
    used+=cost; // Charge before the D1 attempt, even if it throws.
  };
  const store:PrivateOptionStore={
    get usedQueries(){return used},
    get remainingQueries(){return OPTIONS_STORE_MAX_QUERIES-used},
    async get(name,caller){
      authorize(caller,readCap);
      if(!stringWithin(name,OPTION_WRITE_NAME_MAX_BYTES))return refuse();
      consume(GET_OPTION_QUERY_COST);
      // Returning at most two rows makes duplicate option names detectable.
      // Oversized SQLite text is projected as NULL before crossing D1.
      const table='"'+writeConfig.table+'"',scope='"'+writeConfig.scope.column+'"';
      const sql='SELECT CASE WHEN typeof("option_value") = \x27text\x27 '+
        'AND length(CAST("option_value" AS BLOB)) <= ? '+
        'THEN "option_value" ELSE NULL END AS "option_value" FROM '+table+
        ' WHERE '+scope+' = ? AND "option_name" = ? LIMIT 2';
      let result:Awaited<ReturnType<D1PreparedStatement["all"]>>;
      try{
        result=await db.prepare(sql).bind(
          OPTION_WRITE_VALUE_MAX_BYTES,writeConfig.scope.value,name
        ).all();
      }catch{return refuse();}
      if(!result||result.success!==true||!Array.isArray(result.results)||
         result.results.length>1)return refuse();
      if(result.results.length===0)
        return Object.freeze({found:false,value:null,queryCount:1});
      const row=result.results[0] as Record<string,unknown>|undefined;
      if(!row||typeof row!=="object"||Array.isArray(row)||
         Object.keys(row).join(",")!=="option_value"||
         typeof row.option_value!=="string"||
         encoder.encode(row.option_value).byteLength>OPTION_WRITE_VALUE_MAX_BYTES)
        return refuse();
      return Object.freeze({found:true,value:row.option_value,queryCount:1});
    },
    async all(caller){
      authorize(caller,readCap);
      consume(ALL_OPTIONS_QUERY_COST);
      try{
        return await loadSingleWordPressAutoloadOptions(
          WORDPRESS_AUTOLOAD_QUERY,writeConfig,db
        );
      }catch{return refuse();}
    },
    async put(name,value,autoload,caller){
      authorize(caller,writeConfig.writeCapabilities.put);
      if(!stringWithin(name,OPTION_WRITE_NAME_MAX_BYTES)||
         typeof value!=="string"||encoder.encode(value).byteLength>OPTION_WRITE_VALUE_MAX_BYTES||
         typeof autoload!=="string")return refuse();
      consume(1);
      try{
        return await mutateTrustedWordPressOption(
          {op:"put",name,value,autoload},
          writeConfig,db,writeConfig.writeCapabilities.put
        );
      }catch{return refuse();}
    },
    async delete(name,caller){
      authorize(caller,writeConfig.writeCapabilities.delete);
      if(!stringWithin(name,OPTION_WRITE_NAME_MAX_BYTES))return refuse();
      consume(2);
      try{
        return await mutateTrustedWordPressOption(
          {op:"delete",name},
          writeConfig,db,writeConfig.writeCapabilities.delete
        );
      }catch{return refuse();}
    }
  };
  return Object.freeze(store);
}
