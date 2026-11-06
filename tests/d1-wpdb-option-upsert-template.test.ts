import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  PINNED_WP_OPTION_UPSERT_TEMPLATE,executePinnedWordPressOptionUpsert
} from "../src/php/d1-wpdb-conformance/options-upsert-template";
import type {
  TrustedOptionWriteConfig,OptionWriteDatabase
} from "../src/php/d1-wpdb-conformance/options-mutation";

const put=Object.freeze({put:true}),del=Object.freeze({delete:true});
const config:TrustedOptionWriteConfig={
  table:"wp_options",scope:{column:"site_id",value:"site_a"},
  writeCapabilities:{put,delete:del}
};
function fixture(unique=true){
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options ("+
    "site_id TEXT NOT NULL,option_name TEXT NOT NULL,"+
    "option_value TEXT,autoload TEXT NOT NULL)");
  if(unique)sqlite.exec("CREATE UNIQUE INDEX scoped_option "+
    "ON wp_options(site_id,option_name)");
  const statements:Array<{sql:string;args:unknown[]}>= [];
  const db={
    prepare(sql:string){
      return {bind(...args:unknown[]){
        statements.push({sql,args});
        return {run:async()=>{
          const res=sqlite.prepare(sql).run(...args as Array<string|number|null>);
          return {success:true,meta:{changes:res.changes}};
        }};
      }};
    },
    batch:async()=>[]
  } as unknown as OptionWriteDatabase;
  return {sqlite,statements,db};
}
describe("pinned WordPress pre-prepare MySQL option upsert on scoped native D1",()=>{
 test("preserves site isolation and SQL-literal content on one prepared SQLite UPSERT",async()=>{
   const f=fixture();
   f.sqlite.prepare("INSERT INTO wp_options VALUES (?,?,?,?)")
     .run("site_b","shared","private","on");
   const untrustedValue="test ' ON DUPLICATE KEY UPDATE site_id = 'site_b";
   const one=await executePinnedWordPressOptionUpsert(
     PINNED_WP_OPTION_UPSERT_TEMPLATE,
     ["shared",untrustedValue,"yes"],config,f.db,put
   );
   expect(one).toEqual({operation:"put",changed:1,queryCount:1});
   const two=await executePinnedWordPressOptionUpsert(
     PINNED_WP_OPTION_UPSERT_TEMPLATE,
     ["shared","revised","auto-on"],config,f.db,put
   );
   expect(two).toEqual({operation:"put",changed:1,queryCount:1});
   expect(f.statements).toHaveLength(2);
   expect(f.statements.every(i=>i.sql.includes("ON CONFLICT"))).toBe(true);
   expect(f.statements.every(i=>i.sql.includes("site_id"))).toBe(true);
   expect(f.statements[0]?.sql).not.toContain(untrustedValue);
   expect(f.statements[0]?.args)
     .toEqual(["site_a","shared",untrustedValue,"yes"]);
   expect(f.sqlite.prepare("SELECT option_value,autoload FROM wp_options "+
     "WHERE site_id='site_a' AND option_name='shared'").get())
     .toEqual({option_value:"revised",autoload:"auto-on"});
   expect(f.sqlite.prepare("SELECT option_value FROM wp_options "+
     "WHERE site_id='site_b'").get()).toEqual({option_value:"private"});
   f.sqlite.close();
 });
 test("rejects every unapproved template and malformed typed values before D1",async()=>{
   const f=fixture();
   const good=PINNED_WP_OPTION_UPSERT_TEMPLATE;
   const variants=[
     good+"; DROP TABLE wp_options",
     good.replace("wp_options","wp_users"),
     good.replace("VALUES(option_value)","VALUES(site_id)"),
     good.replace("option_value =","site_id ="),
     good.replace(" ON DUPLICATE","; ON DUPLICATE"),
     good.toLowerCase(),
     "INSERT INTO wp_options VALUES (%s,%s,%s)",
     "UPDATE wp_options SET option_value=%s",
     ""
   ];
   for(const sql of variants){
     await expect(executePinnedWordPressOptionUpsert(sql,
       ["a","v","yes"],config,f.db,put)).rejects.toThrow(
         "Private WordPress option UPSERT template rejected"
       );
   }
   for(const args of [
     ["a"],["a","v"],["a","v","on","extra"],
     [null,"v","on"],[42,"v","on"],["x\u0000","v","on"],
     ["x".repeat(192),"v","on"],["x","v".repeat(2049),"on"],
     ["x","v",null],["x","v","bad"],new Array(3)
   ]){
     await expect(executePinnedWordPressOptionUpsert(good,args,
       config,f.db,put)).rejects.toThrow();
   }
   await expect(executePinnedWordPressOptionUpsert(good,
     ["x","v","on"],config,f.db,del)).rejects.toThrow();
   await expect(executePinnedWordPressOptionUpsert(good,
     ["x","v","on"],{...config,table:"wp_users"},f.db,put)).rejects.toThrow();
   expect(f.statements).toHaveLength(0);
   f.sqlite.close();
 });
 test("requires actual UNIQUE(site_id,option_name) rather than silently inserting",async()=>{
   const f=fixture(false);
   await expect(executePinnedWordPressOptionUpsert(
     PINNED_WP_OPTION_UPSERT_TEMPLATE,
     ["x","v","yes"],config,f.db,put
   )).rejects.toThrow("Private WordPress option UPSERT template rejected");
   expect(f.sqlite.prepare("SELECT COUNT(*) as n FROM wp_options").get())
     .toEqual({n:0});
   f.sqlite.close();
 });
 test("never installs pinned SQL parser into deployed WordPress or staging",()=>{
   expect(PINNED_WP_OPTION_UPSERT_TEMPLATE).toContain("ON DUPLICATE KEY UPDATE");
   expect(PINNED_WP_OPTION_UPSERT_TEMPLATE).toContain("VALUES (%s, %s, %s)");
   for(const path of ["src/php/native.ts","src/index-durable.ts",
     "src/php/d1-wpdb/db.php"]){
     expect(readFileSync(path,"utf8"))
       .not.toContain("d1-wpdb-conformance/options-upsert-template");
   }
 });
});
