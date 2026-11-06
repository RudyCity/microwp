import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {createD1RuntimeAdapter} from "../src/php/d1-protocol/runtime-adapter";
import {
  loadVerifiedWordPressAutoloadOptions,MAX_AUTOLOAD_OPTIONS
} from "../src/php/d1-wpdb-conformance/options-complete";

const query = "SELECT option_name, option_value FROM wp_options WHERE autoload IN ( 'yes', 'on', 'auto-on', 'auto' )";
const config = {table:"wp_options"} as const;

function fixture(count:number) {
  const sqlite=new Database(":memory:");
  sqlite.exec("CREATE TABLE wp_options(site_id TEXT,option_name TEXT,option_value TEXT,autoload TEXT)");
  const insert=sqlite.prepare("INSERT INTO wp_options VALUES (?,?,?,?)");
  for(let index=0;index<count;index++){
    const name="option_"+String(index).padStart(4,"0");
    insert.run("site_a",name,"value_"+index,index%2===0?"yes":"auto");
    insert.run("site_b",name,"private_"+index,"yes");
  }
  let requests=0;
  const sqlCalls: {sql:string;params:unknown[]}[]=[];
  const db={
    prepare(sql:string){
      return {bind(...params:unknown[]){
        sqlCalls.push({sql,params});
        return {async all(){
          return {success:true,results:sqlite.prepare(sql).all(...params as (string|number|null)[])};
        }};
      }};
    }
  } as unknown as D1Database;
  const key={privateCaller:true};
  const adapter=createD1RuntimeAdapter({
    db,callerKey:key,policy:{tables:{wp_options:{
      select:["option_name","option_value"],
      filter:["autoload"],order:["option_name"],
      scope:{column:"site_id",value:"site_a"}
    }}}
  });
  const dispatch=async(message:string)=>{
    requests++;
    return adapter.dispatch(message,key);
  };
  return {sqlite,insert,dispatch,key,adapter,sqlCalls,get requests(){return requests}};
}

describe("WordPress autoload D1 complete bounded two-pass verification",()=>{
  test("reads 65 WordPress options over two pages without cross-site data",async()=>{
    const f=fixture(65);
    const options=await loadVerifiedWordPressAutoloadOptions(query,config,f.dispatch);
    expect(Object.getPrototypeOf(options)).toBeNull();
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.keys(options)).toHaveLength(65);
    expect(options.option_0000).toBe("value_0");
    expect(options.option_0064).toBe("value_64");
    expect(Object.values(options).some(v=>v.startsWith("private_"))).toBe(false);
    expect(f.requests).toBe(4);
    expect(f.sqlCalls.every(c=>c.sql.includes('"site_id" = ?'))).toBe(true);
    expect(f.sqlCalls.every(c=>c.params.includes("site_a"))).toBe(true);
    f.sqlite.close();
  });
  test("exactly 500 items requires a zero-length overflow probe on both passes",async()=>{
    const f=fixture(MAX_AUTOLOAD_OPTIONS);
    const options=await loadVerifiedWordPressAutoloadOptions(query,config,f.dispatch,"full");
    expect(Object.keys(options)).toHaveLength(MAX_AUTOLOAD_OPTIONS);
    expect(f.requests).toBe(22);
    expect(f.sqlCalls.some(c=>c.params.at(-1)===500)).toBe(true);
    f.sqlite.close();
  });
  test("501 options fail closed rather than truncating options state",async()=>{
    const f=fixture(MAX_AUTOLOAD_OPTIONS+1);
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,f.dispatch))
      .rejects.toThrow("could not be verified");
    expect(f.requests).toBe(11);
    f.sqlite.close();
  });
  test("an option changed between passes invalidates the entire result",async()=>{
    const f=fixture(65);
    const dispatch=async(wire:string)=>{
      const parsed=JSON.parse(wire);
      if(parsed.id==="autoload_v1_p0"){
        f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id=? AND option_name=?")
          .run("mutated","site_a","option_0000");
      }
      return f.dispatch(wire);
    };
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,dispatch))
      .rejects.toThrow("could not be verified");
    f.sqlite.close();
  });
  test("row inserted during paging cannot be returned as a seemingly complete result",async()=>{
    const f=fixture(65);
    const dispatch=async(wire:string)=>{
      const parsed=JSON.parse(wire);
      if(parsed.id==="autoload_v0_p1"){
        f.insert.run("site_a","option_0000a","new","yes");
      }
      return f.dispatch(wire);
    };
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,dispatch))
      .rejects.toThrow("could not be verified");
    f.sqlite.close();
  });
  test("D1 errors, mismatched response IDs and malformed envelopes reject all options",async()=>{
    const f=fixture(3);
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,
      async()=>JSON.stringify({version:1,id:"wrong",ok:true,op:"select",rows:[]})))
      .rejects.toThrow();
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,
      async()=>JSON.stringify({version:1,id:"autoload_v0_p0",ok:false,error:"NOT_ALLOWED"})))
      .rejects.toThrow();
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,
      async()=>"{broken json"))
      .rejects.toThrow();
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,
      async()=>{throw Error("sensitive private D1 details")}))
      .rejects.toThrow("could not be verified");
    f.sqlite.close();
  });
  test("rejects an overlarge option value even in an otherwise valid D1 response",async()=>{
    const f=fixture(2);
    const dispatch=async(wire:string)=>{
      const response=JSON.parse(await f.dispatch(wire));
      if(response.rows?.length)response.rows[0].option_value="X".repeat(33000);
      return JSON.stringify(response);
    };
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,dispatch)).rejects.toThrow();
    f.sqlite.close();
  });
  test("a response with duplicate keys or unordered rows fails closed",async()=>{
    const f=fixture(3);
    for (const variant of ["duplicate","reversed"] as const) {
      const dispatch=async(wire:string)=>{
        const response=JSON.parse(await f.dispatch(wire));
        if (response.rows?.length>=2) {
          if (variant==="duplicate") response.rows[1].option_name=response.rows[0].option_name;
          else response.rows.reverse();
        }
        return JSON.stringify(response);
      };
      await expect(loadVerifiedWordPressAutoloadOptions(query,config,dispatch))
        .rejects.toThrow("could not be verified");
    }
    f.sqlite.close();
  });
  test("aggregate 256 KiB budget rejects many individually valid values",async()=>{
    const f=fixture(310);
    f.sqlite.prepare("UPDATE wp_options SET option_value=? WHERE site_id=?")
      .run("V".repeat(950),"site_a");
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,f.dispatch))
      .rejects.toThrow("could not be verified");
    f.sqlite.close();
  });
  test("the complete-read prototype is never imported by active WordPress or staging",()=>{
    const native=readFileSync("src/php/native.ts","utf8");
    const durable=readFileSync("src/index-durable.ts","utf8");
    const staging=JSON.parse(readFileSync("wrangler.staging.jsonc","utf8"));
    expect(native).not.toContain("d1-wpdb-conformance/options-complete");
    expect(durable).not.toContain("d1-wpdb-conformance/options-complete");
    expect(staging.vars?.MICROWP_NATIVE_D1_WPDB_ENABLED).not.toBe("yes");
  });
  test("only a trusted canonical query and bounded request ID can reach D1",async()=>{
    const f=fixture(1);
    for(const bad of [
      query+"; DROP TABLE wp_options",
      query.replace("FROM wp_options","FROM wp_users")
    ]){
      await expect(loadVerifiedWordPressAutoloadOptions(bad,config,f.dispatch)).rejects.toThrow();
    }
    await expect(loadVerifiedWordPressAutoloadOptions(query,config,f.dispatch,"bad prefix"))
      .rejects.toThrow();
    expect(f.requests).toBe(0);
    f.sqlite.close();
  });
  test("null prototype prevents __proto__ and constructor option-name pollution",async()=>{
    const f=fixture(0);
    f.insert.run("site_a","__proto__","safe_value","yes");
    f.insert.run("site_a","constructor","safe_constructor","yes");
    const options=await loadVerifiedWordPressAutoloadOptions(query,config,f.dispatch);
    expect(Object.getPrototypeOf(options)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(options,"__proto__")?.value).toBe("safe_value");
    expect(Object.getOwnPropertyDescriptor(options,"constructor")?.value).toBe("safe_constructor");
    expect(({} as Record<string,unknown>).safe_value).toBeUndefined();
    f.sqlite.close();
  });
});
