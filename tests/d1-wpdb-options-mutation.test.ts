import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {
  mutateTrustedWordPressOption,OPTION_PUT_QUERY_COUNT,OPTION_DELETE_QUERY_COUNT,
  type OptionMutation
} from "../src/php/d1-wpdb-conformance/options-mutation";

const capPut=Object.freeze({op:"host-put"}),capDelete=Object.freeze({op:"host-delete"});
const config={table:"wp_options",scope:{column:"site_id",value:"site_a"},
  writeCapabilities:{put:capPut,delete:capDelete}} as const;
const put=(name:string,value:string,autoload="on"):OptionMutation=>({op:"put",name,value,autoload});
const del=(name:string):OptionMutation=>({op:"delete",name});
type Statement={sql:string;args:(string|number|null)[]};
function fixture(unique=true){
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options (site_id TEXT NOT NULL,option_name TEXT NOT NULL,option_value TEXT NOT NULL,autoload TEXT NOT NULL)");
  if(unique)sqlite.exec("CREATE UNIQUE INDEX site_options_unique ON wp_options(site_id,option_name)");
  sqlite.prepare("INSERT INTO wp_options VALUES (?,?,?,?)").run("site_b","shared","secret_b","on");
  const statements:Statement[]=[];
  let batches=0,prepares=0;
  const db={
    prepare(sql:string){
      prepares++;
      return {bind(...args:(string|number|null)[]){
        const s:Statement={sql,args};statements.push(s);
        return {
          ...s,
          async run(){const r=sqlite.prepare(sql).run(...args);
            return {success:true,meta:{changes:r.changes}}},
          async all(){return {success:true,results:sqlite.prepare(sql).all(...args)}}};
      }};
    },
    async batch(list:Statement[]){
      batches++;
      return sqlite.transaction(()=>list.map(s=>{
        if(s.sql.startsWith("SELECT "))return {
          success:true,results:sqlite.prepare(s.sql).all(...s.args)};
        const r=sqlite.prepare(s.sql).run(...s.args);
        return {success:true,results:[],meta:{changes:r.changes}};
      }))();
    }
  } as unknown as D1Database;
  const rows=()=>sqlite.prepare(
    "SELECT site_id,option_name,option_value,autoload FROM wp_options ORDER BY site_id,option_name"
  ).all() as Record<string,unknown>[];
  return {sqlite,db,rows,statements,get batches(){return batches},
    get prepares(){return prepares}};
}
const run=(f:ReturnType<typeof fixture>,request:OptionMutation,cap:object)=>
  mutateTrustedWordPressOption(request,config,f.db,cap);

describe("private one-query WordPress D1 option mutation contract",()=>{
  test("host-authorized one-query UPSERT creates and modifies site A only",async()=>{
    const f=fixture();
    const first=await run(f,put("shared","value_a"),capPut);
    expect(first).toEqual({operation:"put",changed:1,queryCount:1});
    expect(Object.isFrozen(first)).toBe(true);
    const second=await run(f,put("shared","changed","auto-on"),capPut);
    expect(second.changed).toBe(1);
    expect(f.statements).toHaveLength(2);
    expect(f.statements[0].sql).toContain('ON CONFLICT ("site_id", "option_name") DO UPDATE');
    expect(f.statements[0].args).toEqual(["site_a","shared","value_a","on"]);
    expect(f.rows()).toEqual([
      {site_id:"site_a",option_name:"shared",option_value:"changed",autoload:"auto-on"},
      {site_id:"site_b",option_name:"shared",option_value:"secret_b",autoload:"on"}
    ]);
    expect(OPTION_PUT_QUERY_COUNT).toBe(1);
    f.sqlite.close();
  });
  test("atomic two-query DELETE deletes scoped row and reports missing row",async()=>{
    const f=fixture();
    await run(f,put("one","value"),capPut);
    const before=f.batches;
    const result=await run(f,del("one"),capDelete);
    expect(result).toEqual({operation:"delete",changed:1,queryCount:2});
    expect(f.batches).toBe(before+1);
    expect(OPTION_DELETE_QUERY_COUNT).toBe(2);
    expect((await run(f,del("one"),capDelete)).changed).toBe(0);
    expect(f.rows()).toEqual([{
      site_id:"site_b",option_name:"shared",option_value:"secret_b",autoload:"on"
    }]);
    expect(f.statements.at(-1)?.sql).toContain("SELECT COUNT(*)");
    f.sqlite.close();
  });
  test("mismatched/forged or crossed capabilities never even prepare SQL",async()=>{
    const f=fixture();
    for(const [op,cap] of [
      [put("x","v"),capDelete],
      [del("shared"),capPut],
      [put("x","v"),Object.freeze({op:"host-put"})],
      [del("shared"),Object.freeze({op:"host-delete"})]
    ] as const){
      await expect(run(f,op,cap)).rejects.toThrow("Private WordPress D1 option write rejected");
    }
    expect(f.prepares).toBe(0);
    expect(f.batches).toBe(0);
    f.sqlite.close();
  });
  test("rejects invalid autoload state, names, oversized payloads and extra keys",async()=>{
    const f=fixture();
    for(const bad of [
      put("x","abc","x"),
      put("","abc"),put("a\u0000b","v"),put("é".repeat(100),"v"),
      put("safe","X".repeat(2049)),
      {...put("safe","x"),sql:"DROP TABLE wp_options"},
      {...del("shared"),value:"ignored"},
      {op:"truncate",name:"shared"},
      null
    ]){
      await expect(run(f,bad as OptionMutation,capPut)).rejects.toThrow();
    }
    expect(f.prepares).toBe(0);
    f.sqlite.close();
  });
  test("malformed site scope, reserved names and reused caps fail before SQL",async()=>{
    const f=fixture();
    const invalid=[
      {...config,scope:{column:"option_name",value:"site_a"}},
      {...config,scope:{column:"site_id",value:""}},
      {...config,scope:{column:"site_id",value:"x".repeat(192)}},
      {...config,table:"sqlite_master"},
      {...config,table:"wp_options; DROP"},
      {...config,writeCapabilities:{put:capPut,delete:capPut}}
    ];
    for(const cfg of invalid)await expect(
      mutateTrustedWordPressOption(put("x","v"),cfg,f.db,capPut)
    ).rejects.toThrow();
    expect(f.prepares).toBe(0);
    f.sqlite.close();
  });
  test("missing unique constraint makes UPSERT fail closed without an insert",async()=>{
    const f=fixture(false);
    await expect(run(f,put("new","value"),capPut)).rejects.toThrow();
    expect(f.rows()).toHaveLength(1);
    f.sqlite.close();
  });
  test("duplicate site option rows abort DELETE with no destructive effect",async()=>{
    const f=fixture(false);
    f.sqlite.prepare("INSERT INTO wp_options VALUES (?,?,?,?)").run("site_a","dup","one","on");
    f.sqlite.prepare("INSERT INTO wp_options VALUES (?,?,?,?)").run("site_a","dup","two","on");
    await expect(run(f,del("dup"),capDelete)).rejects.toThrow();
    expect(f.batches).toBe(1);
    expect(f.rows().filter(x=>x.option_name==="dup")).toHaveLength(2);
    f.sqlite.close();
  });
  test("D1 exceptions and damaged metadata return only a generic failure",async()=>{
    const f=fixture();
    const db={prepare:()=>({bind:()=>({run:async()=>{throw Error("sensitive backend")}})}),
      batch:async()=>{throw Error("sensitive backend")}} as unknown as D1Database;
    await expect(mutateTrustedWordPressOption(put("x","v"),config,db,capPut))
      .rejects.toThrow("Private WordPress D1 option write rejected");
    await expect(mutateTrustedWordPressOption(del("x"),config,db,capDelete))
      .rejects.toThrow("Private WordPress D1 option write rejected");
    for(const bad of [
      {success:false,meta:{changes:1}},
      {success:true,meta:{changes:2}},
      {success:true,meta:{changes:"1"}}
    ]){
      const mock={...db,prepare:()=>({bind:()=>({run:async()=>bad})})} as unknown as D1Database;
      await expect(mutateTrustedWordPressOption(put("x","v"),config,mock,capPut))
        .rejects.toThrow();
    }
    f.sqlite.close();
  });
  test("malformed D1 batch cannot claim DELETE success",async()=>{
    for(const output of [
      [],[{success:true,results:[{matches:0}]}],
      [{success:true,results:[{matches:2}]},{success:true,meta:{changes:0}}],
      [{success:true,results:[{matches:1}]},{success:true,meta:{changes:0}}],
      [{success:true,results:[{matches:1,leak:"x"}]},{success:true,meta:{changes:1}}]
    ]){
      const db={prepare:()=>({bind:()=>({})}),batch:async()=>output} as unknown as D1Database;
      await expect(mutateTrustedWordPressOption(del("x"),config,db,capDelete))
        .rejects.toThrow("Private WordPress D1 option write rejected");
    }
  });
  test("experimental option write is never installed in WordPress or staging",()=>{
    for(const file of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"]){
      expect(readFileSync(file,"utf8")).not.toContain("d1-wpdb-conformance/options-mutation");
    }
    const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    expect(staging.vars?.MICROWP_NATIVE_D1_WPDB_ENABLED).not.toBe("yes");
  });
});
