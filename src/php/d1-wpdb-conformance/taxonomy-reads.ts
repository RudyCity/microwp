/**
 * Private, fixed WordPress taxonomy JOIN proof on query-native D1.
 *
 * This is not a general JOIN/SQL translator and is never installed in wpdb.
 * The host fixes all tables, columns, join predicates, ordering and site scope.
 */
import {validIdentifier} from "../d1-protocol/protocol";

export const TAXONOMY_OBJECT_MAX_IDS=16;
export const TAXONOMY_MAX_NAMES=8;
export const TAXONOMY_MAX_ROWS=128;
export const TAXONOMY_NAME_MAX_BYTES=200;
export const TAXONOMY_SLUG_MAX_BYTES=200;
export const TAXONOMY_DESCRIPTION_MAX_BYTES=8*1024;
export const TAXONOMY_TOTAL_MAX_BYTES=128*1024;

export interface TrustedTaxonomyReadConfig {
  readonly scope:{readonly column:string;readonly value:string};
  readonly capability:object;
}
export interface PrivateObjectTermRow {
  readonly object_id:number;
  readonly term_id:number;
  readonly name:string;
  readonly slug:string;
  readonly term_taxonomy_id:number;
  readonly taxonomy:string;
  readonly description:string;
  readonly parent:number;
  readonly count:number;
  readonly term_order:number;
}
export interface TaxonomyReadDatabase {prepare:D1Database["prepare"]}

const encoder=new TextEncoder();
const OUTPUT_COLUMNS=[
  "object_id","term_id","name","slug","term_taxonomy_id","taxonomy",
  "description","parent","count","term_order"
] as const;
function refuse():never{throw Error("Private WordPress taxonomy D1 read rejected");}
function capability(value:unknown):value is object{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
function bytes(value:string):number{return encoder.encode(value).byteLength}
function text(value:unknown,max:number,empty=true):value is string{
  return typeof value==="string"&&!value.includes("\u0000")&&
    (empty||value.length>0)&&bytes(value)<=max;
}
function integer(value:unknown):value is number{
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
}
function denseDistinctIntegers(value:unknown,max:number):value is readonly number[]{
  if(!Array.isArray(value)||value.length<1||value.length>max)return false;
  for(let i=0;i<value.length;i++){
    if(!Object.hasOwn(value,i)||!integer(value[i])||value[i]===0)return false;
  }
  return new Set(value).size===value.length;
}
function denseTaxonomies(value:unknown):value is readonly string[]{
  if(!Array.isArray(value)||value.length<1||value.length>TAXONOMY_MAX_NAMES)return false;
  for(let i=0;i<value.length;i++){
    if(!Object.hasOwn(value,i)||!text(value[i],32,false)||
       !/^[a-z0-9_-]+$/.test(value[i]))return false;
  }
  return new Set(value).size===value.length;
}
function validConfig(config:unknown):config is TrustedTaxonomyReadConfig{
  if(!config||typeof config!=="object"||Array.isArray(config))return false;
  const c=config as Record<string,unknown>,s=c.scope;
  if(!s||typeof s!=="object"||Array.isArray(s))return false;
  const scope=s as Record<string,unknown>;
  return Object.keys(c).sort().join(",")==="capability,scope"&&
    Object.keys(scope).sort().join(",")==="column,value"&&
    validIdentifier(scope.column)&&
    !OUTPUT_COLUMNS.includes(scope.column as never)&&
    typeof scope.value==="string"&&scope.value.length>0&&
    !scope.value.includes("\u0000")&&bytes(scope.value)<=191&&
    capability(c.capability);
}
function quote(name:string):string{
  if(!validIdentifier(name))return refuse();
  return '"'+name+'"';
}
function boundedProjection(alias:string,column:string,max:number):string{
  if(!validIdentifier(alias)||!validIdentifier(column))return refuse();
  const q=alias+"."+quote(column);
  return "CASE WHEN typeof("+q+") = 'text' AND length(CAST("+q+
    " AS BLOB)) <= ? THEN "+q+" ELSE NULL END AS "+quote(column);
}
function keys(row:Record<string,unknown>):boolean{
  const actual=Object.keys(row).sort(),expected=[...OUTPUT_COLUMNS].sort();
  return actual.length===expected.length&&actual.every((key,i)=>key===expected[i]);
}

/**
 * Reads terms attached to 1..16 object IDs and 1..8 explicit taxonomies using
 * one fixed three-table DISTINCT JOIN. Every table receives the host site scope.
 */
export async function readPrivateObjectTerms(
  objectIds:readonly number[],taxonomies:readonly string[],
  config:TrustedTaxonomyReadConfig,db:TaxonomyReadDatabase,
  callerCapability:object
):Promise<readonly PrivateObjectTermRow[]>{
  if(!validConfig(config)||callerCapability!==config.capability||
     !capability(callerCapability)||
     !denseDistinctIntegers(objectIds,TAXONOMY_OBJECT_MAX_IDS)||
     !denseTaxonomies(taxonomies)||!db||typeof db.prepare!=="function")
    return refuse();
  const objects=Object.freeze([...objectIds]),tax=Object.freeze([...taxonomies]);
  const s=quote(config.scope.column);
  const sql='SELECT DISTINCT tr."object_id" AS "object_id", t."term_id" AS "term_id", '+
    boundedProjection("t","name",TAXONOMY_NAME_MAX_BYTES)+', '+
    boundedProjection("t","slug",TAXONOMY_SLUG_MAX_BYTES)+
    ', tt."term_taxonomy_id" AS "term_taxonomy_id", '+
    boundedProjection("tt","taxonomy",32)+', '+
    boundedProjection("tt","description",TAXONOMY_DESCRIPTION_MAX_BYTES)+
    ', tt."parent" AS "parent", tt."count" AS "count", '+
    'tr."term_order" AS "term_order" FROM "wp_term_relationships" tr '+
    'INNER JOIN "wp_term_taxonomy" tt ON tt."term_taxonomy_id" = tr."term_taxonomy_id" '+
    'INNER JOIN "wp_terms" t ON t."term_id" = tt."term_id" '+
    'WHERE tr.'+s+' = ? AND tt.'+s+' = ? AND t.'+s+' = ? '+
    'AND tr."object_id" IN ('+objects.map(()=>"?").join(", ")+') '+
    'AND tt."taxonomy" IN ('+tax.map(()=>"?").join(", ")+') '+
    'ORDER BY tr."object_id" ASC, t."term_id" ASC, tt."term_taxonomy_id" ASC LIMIT ?';
  let raw:Awaited<ReturnType<D1PreparedStatement["all"]>>;
  try{
    raw=await db.prepare(sql).bind(
      TAXONOMY_NAME_MAX_BYTES,TAXONOMY_SLUG_MAX_BYTES,32,
      TAXONOMY_DESCRIPTION_MAX_BYTES,
      config.scope.value,config.scope.value,config.scope.value,
      ...objects,...tax,TAXONOMY_MAX_ROWS+1
    ).all();
  }catch{return refuse();}
  if(!raw||raw.success!==true||!Array.isArray(raw.results)||
     raw.results.length>TAXONOMY_MAX_ROWS)return refuse();
  const wantedObjects=new Set(objects),wantedTax=new Set(tax);
  const rows:PrivateObjectTermRow[]=[];
  let previousObject=0,previousTerm=0,previousTaxonomy=0,total=0;
  const identities=new Set<string>();
  for(const item of raw.results){
    if(!item||typeof item!=="object"||Array.isArray(item))return refuse();
    const row=item as Record<string,unknown>;
    if(!keys(row)||!integer(row.object_id)||row.object_id===0||
       !integer(row.term_id)||row.term_id===0||
       !integer(row.term_taxonomy_id)||row.term_taxonomy_id===0||
       !integer(row.parent)||!integer(row.count)||!integer(row.term_order)||
       !text(row.name,TAXONOMY_NAME_MAX_BYTES)||
       !text(row.slug,TAXONOMY_SLUG_MAX_BYTES)||
       !text(row.taxonomy,32,false)||!wantedTax.has(row.taxonomy as string)||
       !text(row.description,TAXONOMY_DESCRIPTION_MAX_BYTES)||
       !wantedObjects.has(row.object_id as number))return refuse();
    const objectId=row.object_id as number,termId=row.term_id as number;
    const taxId=row.term_taxonomy_id as number;
    if(objectId<previousObject||
       (objectId===previousObject&&termId<previousTerm)||
       (objectId===previousObject&&termId===previousTerm&&taxId<=previousTaxonomy))
      return refuse();
    if(objectId!==previousObject){
      previousObject=objectId;previousTerm=0;previousTaxonomy=0;
    }else if(termId!==previousTerm){
      previousTaxonomy=0;
    }
    previousTerm=termId;previousTaxonomy=taxId;
    const identity=objectId+":"+String(row.term_taxonomy_id);
    if(identities.has(identity))return refuse();
    identities.add(identity);
    total+=bytes(row.name as string)+bytes(row.slug as string)+
      bytes(row.taxonomy as string)+bytes(row.description as string);
    if(total>TAXONOMY_TOTAL_MAX_BYTES)return refuse();
    rows.push(Object.freeze(row as unknown as PrivateObjectTermRow));
  }
  return Object.freeze(rows);
}
