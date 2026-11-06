import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {Database} from "bun:sqlite";
import {translateWordPressAutoloadOptions} from "../src/php/d1-wpdb-conformance/options-autoload";
import {createD1RuntimeAdapter} from "../src/php/d1-protocol/runtime-adapter";
import {MAX_ROWS} from "../src/php/d1-protocol/protocol";
import {indexZip,inflateEntry} from "../src/php/zip-files";

const config={table:"wp_options"} as const;
const canonical="SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";
const translate=(sql:string,page=0)=>translateWordPressAutoloadOptions(sql,"options-page-"+page,config,page);

describe("pinned WordPress autoload options → bounded native D1 SELECT",()=>{
 test("translates the four official WordPress 7.1.4 autoload values",()=>{
  const data=translate(canonical);
  expect(data).toMatchObject({op:"select",table:"wp_options",
   columns:["option_name","option_value"],
   whereIn:{column:"autoload",values:["yes","on","auto-on","auto"]},
   orderBy:{column:"option_name",direction:"asc"},limit:MAX_ROWS,offset:0
  });
 });
 test("allows only official values or hook-removed subsets, never caller-added values",()=>{
  const subset="SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'on', 'auto' )";
  expect(translate(subset).whereIn?.values).toEqual(["on","auto"]);
  for(const list of [
   "'yes','yes'","'yes','false'","'yes','auto-off'",
   "'yes', (SELECT password FROM wp_users)","'yes' OR 1=1","",
   "'YES'","'yes','on','auto-on','auto','on'"
  ]){
   const candidate="SELECT option_name, option_value FROM wp_options WHERE autoload IN ("+list+")";
   expect(()=>translate(candidate)).toThrow();
  }
 });
 test("refuses raw SQL, comments, appended clauses, literal injection and unsafe identifiers",()=>{
  const invalid=[
   canonical+"; DROP TABLE wp_options",
   canonical+" -- tail",
   canonical+" OR 1=1",
   canonical.replace("SELECT option_name, option_value","SELECT *"),
   canonical.replace("FROM wp_options","FROM wp_users"),
   canonical.replace("'yes'","'yes\\' OR 1=1"),
   canonical.replace("autoload IN","option_name IN"),
   canonical.replace("FROM wp_options","FROM wp_options JOIN wp_users ON 1=1"),
   canonical.replace("'on'","'%s'"),
   canonical.replace(" IN "," = "),
  ];
  for(const sql of invalid)expect(()=>translate(sql)).toThrow();
  expect(()=>translate(canonical,21)).toThrow();
  expect(()=>translate(canonical,-1)).toThrow();
 });
 test("matches the checked-in pinned official WordPress autoload source",()=>{
  const archive=new Uint8Array(readFileSync("generated/wordpress-php.bin"));
  const entry=indexZip(archive).find(e=>e.name==="wp-includes/option.php");
  expect(entry).toBeDefined();
  const source=new TextDecoder().decode(inflateEntry(archive,entry!));
  expect(source).toContain("$autoload_values = array( 'yes', 'on', 'auto-on', 'auto' );");
  expect(source).toContain('SELECT option_name, option_value FROM $wpdb->options WHERE autoload IN');
 });
 test("produces paged, scoped and exclusively prepared D1 queries without cross-site leakage",async()=>{
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options(site_id TEXT,option_name TEXT,option_value TEXT,autoload TEXT)");
  const insert=sqlite.prepare("INSERT INTO wp_options VALUES(?,?,?,?)");
  for(let i=0;i<65;i++){
   const name="k_"+String(i).padStart(3,"0");
   insert.run("site_a",name,"value_"+i,i%2===0?"yes":"auto");
   insert.run("site_b",name,"secret_"+i,"yes");
  }
  const queries:Array<{sql:string;params:unknown[]}>= [];
  const db={
   prepare(sql:string){
    return {bind(...params:unknown[]){
     queries.push({sql,params});
     return {async all(){
      return {success:true,results:sqlite.prepare(sql).all(...params as (string|number|null)[])};
     }};
    }};
   }
  } as unknown as D1Database;
  const key={};
  const adapter=createD1RuntimeAdapter({db,callerKey:key,
   policy:{tables:{wp_options:{
    select:["option_name","option_value"],
    filter:["autoload"],order:["option_name"],
    scope:{column:"site_id",value:"site_a"}
   }}}
  });
  const pages=[];
  for(let page=0;page<3;page++){
   const request=translate(canonical,page);
   const result=JSON.parse(await adapter.dispatch(JSON.stringify(request),key));
   expect(result.ok).toBe(true);
   pages.push(result.rows);
   if(result.rows.length<MAX_ROWS)break;
  }
  expect(pages.map(p=>p.length)).toEqual([50,15]);
  const combined=pages.flat();
  expect(combined).toHaveLength(65);
  expect(combined[0]).toEqual({option_name:"k_000",option_value:"value_0"});
  expect(combined.at(-1)).toEqual({option_name:"k_064",option_value:"value_64"});
  expect(queries[0].sql).toContain('"autoload" IN (?, ?, ?, ?)');
  expect(queries[0].sql).toContain('"site_id" = ?');
  expect(queries[0].params).toEqual(["yes","on","auto-on","auto","site_a",50,0]);
  expect(queries[1].params.at(-1)).toBe(50);
  sqlite.close();
 });
});
