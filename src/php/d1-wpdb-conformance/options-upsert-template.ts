/**
 * A narrowly pinned WordPress-shaped MySQL ON DUPLICATE KEY UPDATE template.
 *
 * This is NOT generic MySQL SQL translation and is NOT installed in wpdb.
 * The template and exactly three typed values must be provided separately
 * before wpdb-style placeholder interpolation. No untrusted SQL reaches D1.
 */
import {
  mutateTrustedWordPressOption,
  type TrustedOptionWriteConfig,type OptionWriteDatabase,type OptionWriteResult
} from "./options-mutation";

export const PINNED_WP_OPTION_UPSERT_TEMPLATE=
  "INSERT INTO wp_options (option_name, option_value, autoload) "+
  "VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE "+
  "option_value = VALUES(option_value), autoload = VALUES(autoload)";
const encoder=new TextEncoder();
function refuse():never{throw Error("Private WordPress option UPSERT template rejected");}
/**
 * Translates only this precise pre-prepare template into the existing
 * host-authorized, site-scoped 1-query SQLite UPSERT.
 *
 * The host must enforce the actual scoped UNIQUE index; other unique
 * constraints or WordPress MySQL affected-row semantics are not emulated.
 */
export async function executePinnedWordPressOptionUpsert(
  template:string,
  values:readonly unknown[],
  config:TrustedOptionWriteConfig,
  db:OptionWriteDatabase,
  callerCapability:object
):Promise<OptionWriteResult>{
  if(template!==PINNED_WP_OPTION_UPSERT_TEMPLATE||
     !Array.isArray(values)||values.length!==3||
     ![0,1,2].every(i=>Object.hasOwn(values,i))||
     !config||config.table!=="wp_options"||
     !config.scope||typeof config.scope.value!=="string"||
     !config.writeCapabilities||callerCapability!==config.writeCapabilities.put||
     typeof callerCapability!=="object"||callerCapability===null)
    return refuse();
  const [name,value,autoload]=values;
  if(typeof name!=="string"||name.length<1||
     name.includes("\u0000")||encoder.encode(name).byteLength>191||
     typeof value!=="string"||encoder.encode(value).byteLength>2048||
     typeof autoload!=="string")
    return refuse();
  try{
    return await mutateTrustedWordPressOption(
      {op:"put",name,value,autoload},
      config,db,callerCapability
    );
  }catch{return refuse();}
}
