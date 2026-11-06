import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {
  ATOMIC_AUTOLOAD_BATCH_STATEMENTS,ATOMIC_AUTOLOAD_D1_API_CALLS,loadAtomicWordPressAutoloadOptions
} from "../src/php/d1-wpdb-conformance/options-atomic";

const query="SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";
const config={table:"wp_options",scope:{column:"site_id",value:"site_a"}} as const;

interface MockStatement {
  sql:string;args:unknown[];
}
function fixture(count:number){
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options(site_id TEXT NOT NULL,option_name TEXT NOT NULL,option_value TEXT,autoload TEXT)");
  const insert=sqlite.prepare("INSERT INTO wp_options VALUES(?,?,?,?)");
  for(let i=0;i<count;i++){
    const name="option_"+String(i).padStart(4,"0");
    insert.run("site_a",name,"value_"+i,i%2?"auto":"yes");
    insert.run("site_b",name,"secret_"+i,"yes");
  }
  let batches=0;
  const statements:MockStatement[]=[];
  const db={
    prepare(sql:string){
      return {bind(...args:unknown[]){
        statements.push({sql,args});
        return {sql,args};
      }};
    },
    async batch(list:MockStatement[]){
      batches++;
      return sqlite.transaction(()=>list.map(s=>({
        success:true,
        results:sqlite.prepare(s.sql).all(...s.args as (string|number|null)[])
      })))();
    }
  } as unknown as D1Database;
  return {sqlite,db,insert,statements,get batches(){return batches}};
}

describe("experimental D1 atomic WordPress autoload batch",()=>{
  test("one transactional D1 batch returns 65 site-scoped options, not another site",async()=>{
    const f=fixture(65);
    const options=await loadAtomicWordPressAutoloadOptions(query,config,f.db);
    expect(f.batches).toBe(1);
    expect(f.statements).toHaveLength(ATOMIC_AUTOLOAD_BATCH_STATEMENTS);
    expect(ATOMIC_AUTOLOAD_BATCH_STATEMENTS).toBe(11);
    expect(ATOMIC_AUTOLOAD_D1_API_CALLS).toBe(1);
    expect(Object.getPrototypeOf(options)).toBeNull();
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.keys(options)).toHaveLength(65);
    expect(options.option_0000).toBe("value_0");
    expect(options.option_0064).toBe("value_64");
    expect(Object.values(options).some(v=>v.startsWith("secret_"))).toBe(false);
    expect(f.statements.every(s=>s.sql.includes('"site_id" = ?'))).toBe(true);
    expect(f.statements.every(s=>s.args.includes("site_a"))).toBe(true);
    expect(f.statements[0].sql).toContain('ORDER BY "option_name" COLLATE BINARY ASC LIMIT ? OFFSET ?');
    expect(f.statements[0].args).toEqual([191,2048,"yes","on","auto-on","auto","site_a",50,0]);
    f.sqlite.close();
  });
  test("exactly 500 options accepted, 501 rejected in a single batch",async()=>{
    const a=fixture(500);
    expect(Object.keys(await loadAtomicWordPressAutoloadOptions(query,config,a.db))).toHaveLength(500);
    expect(a.batches).toBe(1);
    expect(a.statements[10].args.at(-1)).toBe(500);
    a.sqlite.close();
    const b=fixture(501);
    await expect(loadAtomicWordPressAutoloadOptions(query,config,b.db))
      .rejects.toThrow("Atomic WordPress D1 autoload read rejected");
    expect(b.batches).toBe(1);
    b.sqlite.close();
  });
  test("SQL-side max-value guard rejects large option values before return",async()=>{
    const f=fixture(2);
    f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id='site_a' AND option_name='option_0000'")
      .run("X".repeat(150000));
    await expect(loadAtomicWordPressAutoloadOptions(query,config,f.db)).rejects.toThrow();
    expect(f.batches).toBe(1);
    expect(f.statements[0].sql).toContain('length(CAST("option_value" AS BLOB)) <= ?');
    f.sqlite.close();
  });
  test("aggregate 256KiB cap rejects many individually bounded values",async()=>{
    const f=fixture(200);
    f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id='site_a'")
      .run("v".repeat(1500));
    await expect(loadAtomicWordPressAutoloadOptions(query,config,f.db)).rejects.toThrow();
    expect(f.batches).toBe(1);
    f.sqlite.close();
  });
  test("UTF-8 overlong option names are rejected without returning a partial map",async()=>{
    const f=fixture(1);
    f.insert.run("site_a","name_"+"é".repeat(100),"large name","yes");
    await expect(loadAtomicWordPressAutoloadOptions(query,config,f.db)).rejects.toThrow();
    f.sqlite.close();
  });
  test("does not prepare SQL when source query, scope or tenant is invalid",async()=>{
    const f=fixture(1);
    const badConfigs=[
      {table:"wp_options",scope:{column:"site_id",value:""}},
      {table:"sqlite_master",scope:{column:"site_id",value:"site_a"}},
      {table:"wp_options",scope:{column:"option_name",value:"site_a"}},
      {table:"wp_options",scope:{column:"site_id",value:"x".repeat(192)}},
      {table:"wp_options;DROP TABLE wp_options",scope:{column:"site_id",value:"site_a"}},
    ];
    for(const c of badConfigs)await expect(loadAtomicWordPressAutoloadOptions(query,c,f.db)).rejects.toThrow();
    for(const text of [
      query+"; DROP TABLE wp_options",
      query.replace("wp_options","wp_users"),
      query.replace("'yes'","'malicious'")
    ])await expect(loadAtomicWordPressAutoloadOptions(text,config,f.db)).rejects.toThrow();
    expect(f.statements).toHaveLength(0);
    expect(f.batches).toBe(0);
    f.sqlite.close();
  });
  test("malformed batch results or exceptions never yield partial WordPress options",async()=>{
    const f=fixture(5);
    const errorDb={
      prepare:f.db.prepare,
      batch:async()=>{throw Error("sensitive: internal database details")}
    } as unknown as D1Database;
    await expect(loadAtomicWordPressAutoloadOptions(query,config,errorDb))
      .rejects.toThrow("Atomic WordPress D1 autoload read rejected");
    const incompleteDb={
      prepare:f.db.prepare,
      batch:async()=>[{success:true,results:[]}]
    } as unknown as D1Database;
    await expect(loadAtomicWordPressAutoloadOptions(query,config,incompleteDb)).rejects.toThrow();
    const deniedDb={
      prepare:f.db.prepare,
      batch:async()=>Array.from({length:ATOMIC_AUTOLOAD_BATCH_STATEMENTS},(_,i)=>({
        success:i!==1,results:[]}))
    } as unknown as D1Database;
    await expect(loadAtomicWordPressAutoloadOptions(query,config,deniedDb)).rejects.toThrow();
    f.sqlite.close();
  });
  test("D1 native batched reader does not install itself in WordPress or staging",()=>{
    const native=readFileSync("src/php/native.ts","utf8");
    const durable=readFileSync("src/index-durable.ts","utf8");
    const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    expect(native).not.toContain("d1-wpdb-conformance/options-atomic");
    expect(durable).not.toContain("d1-wpdb-conformance/options-atomic");
    expect(staging.vars?.MICROWP_NATIVE_D1_WPDB_ENABLED).not.toBe("yes");
  });
});
