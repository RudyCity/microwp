import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {
  SINGLE_AUTOLOAD_D1_QUERIES,SINGLE_AUTOLOAD_ROW_LIMIT,
  loadSingleWordPressAutoloadOptions
} from "../src/php/d1-wpdb-conformance/options-single";

const QUERY="SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";
const CONFIG={table:"wp_options",scope:{column:"site_id",value:"site_a"}} as const;
type Statement={sql:string;args:(string|number|null)[]};
function fixture(count:number){
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options(site_id TEXT NOT NULL,option_name TEXT NOT NULL,option_value TEXT,autoload TEXT)");
  const insert=sqlite.prepare("INSERT INTO wp_options VALUES(?,?,?,?)");
  for(let i=0;i<count;i++){
    const key="option_"+String(i).padStart(4,"0");
    insert.run("site_a",key,"value_"+i,i%2?"auto":"yes");
    insert.run("site_b",key,"private_"+i,"yes");
  }
  const statements:Statement[]=[];
  const db={
    prepare(sql:string){
      return {bind(...args:(string|number|null)[]){
        statements.push({sql,args});
        return {async all(){
          return {success:true,results:sqlite.prepare(sql).all(...args)};
        }};
      }};
    }
  } as unknown as D1Database;
  return {sqlite,db,insert,statements};
}

describe("private single-query D1 WordPress autoload read",()=>{
  test("one prepared SQLite SELECT reads all 65 options for one site",async()=>{
    const f=fixture(65);
    const result=await loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db);
    expect(SINGLE_AUTOLOAD_D1_QUERIES).toBe(1);
    expect(SINGLE_AUTOLOAD_ROW_LIMIT).toBe(501);
    expect(f.statements).toHaveLength(1);
    expect(f.statements[0].args).toEqual([191,2048,"yes","on","auto-on","auto","site_a",501]);
    expect(f.statements[0].sql).toContain('AND "site_id" = ?');
    expect(f.statements[0].sql).toContain('ORDER BY "option_name" COLLATE BINARY ASC LIMIT ?');
    expect(Object.keys(result)).toHaveLength(65);
    expect(result.option_0000).toBe("value_0");
    expect(result.option_0064).toBe("value_64");
    expect(Object.values(result).some(v=>v.startsWith("private_"))).toBe(false);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    f.sqlite.close();
  });
  test("zero, 500 and 501 options discriminate empty, complete and overflow",async()=>{
    for(const count of [0,500,501]){
      const f=fixture(count);
      if(count===501){
        await expect(loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db))
          .rejects.toThrow("Single-query WordPress D1 autoload read rejected");
      }else{
        const options=await loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db);
        expect(Object.keys(options)).toHaveLength(count);
      }
      expect(f.statements).toHaveLength(1);
      f.sqlite.close();
    }
  });
  test("committed update is visible to the next independent SELECT",async()=>{
    const f=fixture(3);
    const first=await loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db);
    f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id=? AND option_name=?")
      .run("updated","site_a","option_0000");
    const second=await loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db);
    expect(first.option_0000).toBe("value_0");
    expect(second.option_0000).toBe("updated");
    expect(f.statements).toHaveLength(2);
    f.sqlite.close();
  });
  test("rejects overlong UTF-8 value, name and aggregate before any partial map",async()=>{
    for(const kind of ["value","name","aggregate"]){
      const f=fixture(kind==="aggregate"?200:2);
      if(kind==="value")f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id='site_a' AND option_name='option_0000'").run("X".repeat(150000));
      if(kind==="name")f.insert.run("site_a","é".repeat(100),"bad","yes");
      if(kind==="aggregate")f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id='site_a'").run("v".repeat(1600));
      await expect(loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db)).rejects.toThrow();
      expect(f.statements).toHaveLength(1);
      f.sqlite.close();
    }
  });
  test("duplicate names, null values and unexpected output shape are rejected",async()=>{
    const f=fixture(2);
    f.insert.run("site_a","option_0000","duplicate","yes");
    await expect(loadSingleWordPressAutoloadOptions(QUERY,CONFIG,f.db)).rejects.toThrow();
    f.sqlite.close();
    const g=fixture(2);
    g.sqlite.prepare("UPDATE wp_options SET option_value=NULL WHERE site_id='site_a'").run();
    await expect(loadSingleWordPressAutoloadOptions(QUERY,CONFIG,g.db)).rejects.toThrow();
    g.sqlite.close();
    for(const results of [[{option_name:"a",option_value:"x",leak:"bad"}],
                          [{option_name:"b",option_value:"x"},{option_name:"a",option_value:"y"}]]){
      const mock={prepare:()=>({bind:()=>({all:async()=>({success:true,results})})})} as unknown as D1Database;
      await expect(loadSingleWordPressAutoloadOptions(QUERY,CONFIG,mock)).rejects.toThrow();
    }
  });
  test("invalid query, scope and table fail before preparing a statement",async()=>{
    const f=fixture(1);
    for(const bad of [
      QUERY+"; DROP TABLE wp_options",
      QUERY.replace("wp_options","wp_users"),
      QUERY.replace("'yes'","'unauthorized'"),
      "SELECT * FROM wp_options"
    ])await expect(loadSingleWordPressAutoloadOptions(bad,CONFIG,f.db)).rejects.toThrow();
    for(const invalid of [
      {table:"wp_options",scope:{column:"option_name",value:"site_a"}},
      {table:"sqlite_master",scope:{column:"site_id",value:"site_a"}},
      {table:"wp_options;DROP",scope:{column:"site_id",value:"site_a"}},
      {table:"wp_options",scope:{column:"site_id",value:""}},
      {table:"wp_options",scope:{column:"site_id",value:"x".repeat(192)}}
    ])await expect(loadSingleWordPressAutoloadOptions(QUERY,invalid,f.db)).rejects.toThrow();
    expect(f.statements).toHaveLength(0);
    f.sqlite.close();
  });
  test("D1 failure and malformed response never return options",async()=>{
    for(const all of [
      async()=>{throw new Error("secret internal exception");},
      async()=>({success:false,results:[]}),
      async()=>({success:true,results:"invalid"}),
      async()=>({success:true,results:Array.from({length:502},()=>({option_name:"a",option_value:"x"}))})
    ]){
      const db={prepare:()=>({bind:()=>({all})})} as unknown as D1Database;
      await expect(loadSingleWordPressAutoloadOptions(QUERY,CONFIG,db))
        .rejects.toThrow("Single-query WordPress D1 autoload read rejected");
    }
  });
  test("not mounted in any production PHP runtime or staging ingress",()=>{
    const native=readFileSync("src/php/native.ts","utf8");
    const durable=readFileSync("src/index-durable.ts","utf8");
    const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    expect(native).not.toContain("d1-wpdb-conformance/options-single");
    expect(durable).not.toContain("d1-wpdb-conformance/options-single");
    expect(staging.vars?.MICROWP_NATIVE_D1_WPDB_ENABLED).not.toBe("yes");
  });
});
