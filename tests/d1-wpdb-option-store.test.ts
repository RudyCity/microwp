import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {
  createPrivateWordPressOptionStore,OPTIONS_STORE_MAX_QUERIES,
  MAX_BATCH_OPTION_KEYS,MAX_BATCH_OPTION_OUTPUT_BYTES,
  WORDPRESS_AUTOLOAD_QUERY,type PrivateOptionStoreConfig
} from "../src/php/d1-wpdb-conformance/options-store";

const readCap=Object.freeze({read:true}),putCap=Object.freeze({put:true}),delCap=Object.freeze({delete:true});
const config:PrivateOptionStoreConfig={
  table:"wp_options",scope:{column:"site_id",value:"site_a"},
  readCapability:readCap,writeCapabilities:{put:putCap,delete:delCap}
};
type Statement={sql:string;args:(string|number|null)[]};
function fixture(unique=true){
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options (site_id TEXT NOT NULL,option_name TEXT NOT NULL,option_value TEXT,autoload TEXT NOT NULL)");
  if(unique)sqlite.exec("CREATE UNIQUE INDEX option_scoped_identity ON wp_options(site_id,option_name)");
  const insert=sqlite.prepare("INSERT INTO wp_options VALUES (?,?,?,?)");
  insert.run("site_b","shared","private_b","on");
  const statements:Statement[]=[];
  const db={
    prepare(sql:string){
      return {bind(...args:(string|number|null)[]){
        const item={sql,args};statements.push(item);
        return {
          ...item,
          async all(){return {success:true,results:sqlite.prepare(sql).all(...args)}},
          async run(){const result=sqlite.prepare(sql).run(...args);
            return {success:true,meta:{changes:result.changes}};}
        };
      }};
    },
    async batch(items:Statement[]){
      return sqlite.transaction(()=>items.map(item=>{
        if(item.sql.startsWith("SELECT "))
          return {success:true,results:sqlite.prepare(item.sql).all(...item.args)};
        const result=sqlite.prepare(item.sql).run(...item.args);
        return {success:true,meta:{changes:result.changes},results:[]};
      }))();
    }
  } as unknown as D1Database;
  return {sqlite,insert,statements,db};
}
describe("trusted composable site-scoped D1 WordPress options store",()=>{
  test("get distinguishes absent from empty, bounds query, and never leaks another site",async()=>{
    const f=fixture();
    f.insert.run("site_a","empty","","on");
    const store=createPrivateWordPressOptionStore(config,f.db);
    const missing=await store.get("shared",readCap);
    const empty=await store.get("empty",readCap);
    expect(missing).toEqual({found:false,value:null,queryCount:1});
    expect(empty).toEqual({found:true,value:"",queryCount:1});
    expect(Object.isFrozen(missing)).toBe(true);
    expect(Object.isFrozen(store)).toBe(true);
    expect(store.usedQueries).toBe(2);
    expect(store.remainingQueries).toBe(48);
    expect(f.statements[0].sql).toContain('"site_id" = ? AND "option_name" = ? LIMIT 2');
    expect(f.statements[0].args).toEqual([2048,"site_a","shared"]);
    f.sqlite.close();
  });
  test("read/autoload/write/delete form one coherent store with fresh D1 reads",async()=>{
    const f=fixture();
    const store=createPrivateWordPressOptionStore(config,f.db);
    expect(WORDPRESS_AUTOLOAD_QUERY).toContain("autoload IN");
    expect((await store.all(readCap))).toEqual(Object.freeze(Object.create(null)));
    expect((await store.put("alpha","one","on",putCap)).changed).toBe(1);
    expect((await store.get("alpha",readCap)).value).toBe("one");
    expect((await store.all(readCap)).alpha).toBe("one");
    await store.put("alpha","two","no",putCap);
    expect((await store.get("alpha",readCap)).value).toBe("two");
    expect(Object.hasOwn(await store.all(readCap),"alpha")).toBe(false);
    await store.put("alpha","three","auto-on",putCap);
    expect((await store.all(readCap)).alpha).toBe("three");
    expect((await store.delete("alpha",delCap)).changed).toBe(1);
    expect((await store.delete("alpha",delCap)).changed).toBe(0);
    expect((await store.get("alpha",readCap)).found).toBe(false);
    expect(f.sqlite.prepare("SELECT option_value FROM wp_options WHERE site_id='site_b'").get())
      .toEqual({option_value:"private_b"});
    expect(store.usedQueries).toBe(14);
    f.sqlite.close();
  });
  test("autoload includes only WordPress four approved flags and rejects overflowing",async()=>{
    const f=fixture();
    const insert=f.insert;
    for(const [key,flag] of [
      ["yes","yes"],["on","on"],["auto-on","auto-on"],["auto","auto"],
      ["no","no"],["off","off"],["auto-off","auto-off"]
    ])insert.run("site_a",key,"value_"+key,flag);
    const store=createPrivateWordPressOptionStore(config,f.db);
    const all=await store.all(readCap);
    expect(Object.keys(all)).toEqual(["auto","auto-on","on","yes"]);
    expect(Object.getPrototypeOf(all)).toBeNull();
    expect(Object.isFrozen(all)).toBe(true);
    f.sqlite.close();
  });
  test("real SQLite oversized value and 501 autoload options fail without partial data",async()=>{
    const f=fixture();
    f.insert.run("site_a","too_large","X".repeat(2050),"on");
    const store=createPrivateWordPressOptionStore(config,f.db);
    await expect(store.get("too_large",readCap)).rejects.toThrow(
      "Private D1 WordPress option store rejected"
    );
    await expect(store.all(readCap)).rejects.toThrow(
      "Private D1 WordPress option store rejected"
    );
    expect(store.usedQueries).toBe(2);
    f.sqlite.close();

    const g=fixture(),reader=createPrivateWordPressOptionStore(config,g.db);
    for(let i=0;i<501;i++){
      g.insert.run("site_a","item_"+String(i).padStart(4,"0"),"value","on");
    }
    await expect(reader.all(readCap)).rejects.toThrow(
      "Private D1 WordPress option store rejected"
    );
    expect(reader.usedQueries).toBe(1);
    g.sqlite.close();
  });
  test("getMany returns missing and present values across one prepared scoped D1 query",async()=>{
    const f=fixture();
    f.insert.run("site_a","alpha","value_a","yes");
    f.insert.run("site_a","empty","","no");
    f.insert.run("site_b","alpha","SECRET_B","yes");
    const store=createPrivateWordPressOptionStore(config,f.db);
    const batch=await store.getMany(["alpha","shared","empty","missing","__proto__"],readCap);
    expect(batch.requested).toBe(5);
    expect(batch.found).toBe(2);
    expect(batch.queryCount).toBe(1);
    expect(Object.getPrototypeOf(batch.values)).toBeNull();
    expect(Object.isFrozen(batch.values)).toBe(true);
    expect(Object.isFrozen(batch)).toBe(true);
    expect({...batch.values}).toEqual(Object.fromEntries([
      ["alpha","value_a"],["shared",null],["empty",""],
      ["missing",null],["__proto__",null]
    ]));
    expect(Object.keys(batch.values)).toContain("__proto__");
    expect(batch.values["__proto__"]).toBeNull();
    expect(store.usedQueries).toBe(1);
    expect(f.statements).toHaveLength(1);
    expect(f.statements[0].args).toEqual([
      191,2048,"site_a","alpha","shared","empty","missing","__proto__",6
    ]);
    expect(f.statements[0].sql).toContain('ORDER BY "option_name" COLLATE BINARY ASC LIMIT ?');
    f.sqlite.close();
  });
  test("getMany accepts 96 names in exactly one D1 query with <=100 bindings",async()=>{
    const f=fixture();
    const keys=Array.from({length:MAX_BATCH_OPTION_KEYS},(_,i)=>"name_"+String(i).padStart(3,"0"));
    keys.forEach((name,i)=>f.insert.run("site_a",name,"v"+i,"no"));
    const store=createPrivateWordPressOptionStore(config,f.db);
    const batch=await store.getMany(keys,readCap);
    expect(batch.requested).toBe(96);
    expect(batch.found).toBe(96);
    expect(batch.values.name_000).toBe("v0");
    expect(batch.values.name_095).toBe("v95");
    expect(f.statements).toHaveLength(1);
    expect(f.statements[0].args).toHaveLength(100);
    expect(store.usedQueries).toBe(1);
    f.sqlite.close();
  });
  test("getMany rejects forged rights, duplicate, missing, oversized and sparse names before preparing",async()=>{
    const f=fixture(),store=createPrivateWordPressOptionStore(config,f.db);
    for(const call of [
      ()=>store.getMany(["x"],putCap),
      ()=>store.getMany([],readCap),
      ()=>store.getMany(["x","x"],readCap),
      ()=>store.getMany(Array.from({length:97},(_,i)=>"key_"+i),readCap),
      ()=>store.getMany(["é".repeat(100)],readCap),
      ()=>store.getMany(["x\u0000y"],readCap),
      ()=>store.getMany([null] as unknown as string[],readCap),
      ()=>store.getMany(new Array(1) as string[],readCap),
    ]) await expect(call()).rejects.toThrow("Private D1 WordPress option store rejected");
    expect(store.usedQueries).toBe(0);
    expect(f.statements).toHaveLength(0);
    f.sqlite.close();
  });
  test("getMany rejects duplicates and oversized D1 values without returning a partial result",async()=>{
    const f=fixture(false),store=createPrivateWordPressOptionStore(config,f.db);
    f.insert.run("site_a","dup","first","yes");
    f.insert.run("site_a","dup","second","yes");
    await expect(store.getMany(["dup"],readCap)).rejects.toThrow();
    f.sqlite.close();
    const tooLarge=fixture(),reader=createPrivateWordPressOptionStore(config,tooLarge.db);
    for(let i=0;i<40;i++){
      tooLarge.insert.run("site_a","key_"+String(i).padStart(2,"0"),"x".repeat(2048),"yes");
    }
    expect(MAX_BATCH_OPTION_OUTPUT_BYTES).toBe(65536);
    await expect(reader.getMany(Array.from({length:40},(_,i)=>
      "key_"+String(i).padStart(2,"0")),readCap)).rejects.toThrow();
    tooLarge.sqlite.close();
    for(const results of [
      [{option_name:"x",option_value:null}],
      [{option_name:"x",option_value:1}],
      [{option_name:"foreign",option_value:"private"}],
      [{option_name:"x",option_value:"v",secret:"a"}],
      [{option_name:"x",option_value:"v"},{option_name:"x",option_value:"v"}],
      [{option_name:"z",option_value:"v"},{option_name:"x",option_value:"v"}]
    ]){
      const db={prepare:()=>({bind:()=>({all:async()=>({success:true,results})})}),
        batch:async()=>[]} as unknown as D1Database;
      await expect(createPrivateWordPressOptionStore(config,db)
        .getMany(["x","z"],readCap)).rejects.toThrow(
         "Private D1 WordPress option store rejected");
    }
  });
  test("getMany sees every committed revision and consumes one store query even on failure",async()=>{
    const f=fixture(),store=createPrivateWordPressOptionStore(config,f.db);
    expect((await store.getMany(["x"],readCap)).values.x).toBeNull();
    await store.put("x","one","on",putCap);
    expect((await store.getMany(["x"],readCap)).values.x).toBe("one");
    await store.put("x","two","no",putCap);
    expect((await store.getMany(["x"],readCap)).values.x).toBe("two");
    await store.delete("x",delCap);
    expect((await store.getMany(["x"],readCap)).values.x).toBeNull();
    expect(store.usedQueries).toBe(8);
    f.sqlite.close();
    const broken={prepare(){throw Error("secret backend")},batch(){throw Error("secret backend")}} as unknown as D1Database;
    const bad=createPrivateWordPressOptionStore(config,broken);
    await expect(bad.getMany(["x"],readCap)).rejects.toThrow(
      "Private D1 WordPress option store rejected");
    expect(bad.usedQueries).toBe(1);
  });
  test("scope and capability identities are frozen snapshots of original config",async()=>{
    const f=fixture();
    const mutable:PrivateOptionStoreConfig={
      table:"wp_options",scope:{column:"site_id",value:"site_a"},
      readCapability:readCap,writeCapabilities:{put:putCap,delete:delCap}
    };
    const store=createPrivateWordPressOptionStore(mutable,f.db);
    (mutable as any).scope={column:"site_id",value:"site_b"};
    (mutable as any).writeCapabilities={put:Object.freeze({fake:true}),delete:Object.freeze({fake:true})};
    (mutable as any).readCapability=Object.freeze({fake:true});
    await store.put("new","safe","on",putCap);
    expect((await store.get("new",readCap)).value).toBe("safe");
    expect(f.sqlite.prepare("SELECT option_value FROM wp_options WHERE site_id='site_b' AND option_name='shared'").get())
      .toEqual({option_value:"private_b"});
    await expect(store.put("new","bad","on",mutable.writeCapabilities.put)).rejects.toThrow();
    expect(store.usedQueries).toBe(2);
    f.sqlite.close();
  });
  test("incompatible or reused capability config fails before any D1 prepare",()=>{
    const f=fixture();
    for(const override of [
      {table:"wp_options;",scope:config.scope,readCapability:readCap,writeCapabilities:config.writeCapabilities},
      {...config,table:"sqlite_master"},
      {...config,scope:{column:"option_name",value:"site_a"}},
      {...config,scope:{column:"site_id",value:""}},
      {...config,readCapability:putCap},
      {...config,writeCapabilities:{put:putCap,delete:putCap}}
    ])expect(()=>createPrivateWordPressOptionStore(override,f.db)).toThrow();
    expect(f.statements).toHaveLength(0);
    f.sqlite.close();
  });
  test("wrong capability or invalid name rejects before a D1 statement or budget charge",async()=>{
    const f=fixture(),store=createPrivateWordPressOptionStore(config,f.db);
    for(const call of [
      ()=>store.get("x",putCap),
      ()=>store.all(delCap),
      ()=>store.put("x","value","on",readCap),
      ()=>store.delete("x",readCap),
      ()=>store.get("é".repeat(100),readCap),
      ()=>store.delete("x\u0000y",delCap),
      ()=>store.put("x","v".repeat(2049),"on",putCap)
    ])await expect(call()).rejects.toThrow("Private D1 WordPress option store rejected");
    expect(store.usedQueries).toBe(0);
    expect(f.statements).toHaveLength(0);
    f.sqlite.close();
  });
  test("one store enforces 50 query ceiling, including failed D1 attempts",async()=>{
    const f=fixture(),store=createPrivateWordPressOptionStore(config,f.db);
    for(let i=0;i<49;i++)await store.get("missing",readCap);
    const before=f.statements.length;
    await expect(store.delete("missing",delCap)).rejects.toThrow();
    expect(f.statements).toHaveLength(before);
    expect(store.remainingQueries).toBe(1);
    await store.get("missing",readCap);
    expect(store.usedQueries).toBe(OPTIONS_STORE_MAX_QUERIES);
    await expect(store.get("missing",readCap)).rejects.toThrow();
    expect(f.statements).toHaveLength(50);
    f.sqlite.close();
    const broken={prepare(){throw new Error("backend private")},batch(){throw new Error("backend private")}} as unknown as D1Database;
    const brokenStore=createPrivateWordPressOptionStore(config,broken);
    await expect(brokenStore.get("x",readCap)).rejects.toThrow("Private D1 WordPress option store rejected");
    expect(brokenStore.usedQueries).toBe(1);
  });
  test("duplicate or malformed D1 result is refused, never silently first-row wins",async()=>{
    const f=fixture(false);
    f.insert.run("site_a","dup","one","on");
    f.insert.run("site_a","dup","two","on");
    const store=createPrivateWordPressOptionStore(config,f.db);
    await expect(store.get("dup",readCap)).rejects.toThrow();
    f.sqlite.close();
    for(const results of [
      [{option_value:null}],
      [{option_value:100}],
      [{option_value:"v",unexpected:"leak"}],
      [{option_value:"X".repeat(2049)}]
    ]){
      const db={prepare:()=>({bind:()=>({all:async()=>({success:true,results})})}),
        batch:async()=>[]} as unknown as D1Database;
      const reader=createPrivateWordPressOptionStore(config,db);
      await expect(reader.get("option",readCap)).rejects.toThrow();
    }
  });
  test("store is not imported by deployed WordPress or staging entrypoints",()=>{
    for(const file of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"]){
      expect(readFileSync(file,"utf8")).not.toContain("d1-wpdb-conformance/options-store");
    }
    const cfg=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    expect(cfg.vars?.MICROWP_NATIVE_D1_WPDB_ENABLED).not.toBe("yes");
  });
});
