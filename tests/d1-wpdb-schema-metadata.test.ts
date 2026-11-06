import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  classifyWordPressMetadataQuery,readPrivateWordPressMetadata,
  type TrustedWordPressMetadataConfig,MAX_METADATA_COLUMNS
} from "../src/php/d1-wpdb-conformance/schema-metadata";

const access=Object.freeze({readSchema:true});
const config:TrustedWordPressMetadataConfig={table:"wp_options",capability:access};
type ProbeCall={sql:string;args:(string|number|null)[]};
function fixture(){
  const sqlite=new Database(":memory:");
  sqlite.exec('CREATE TABLE "wp_options" ('+
    '"site_id" TEXT NOT NULL, "option_name" TEXT NOT NULL,'+
    '"option_value" TEXT, "autoload" TEXT NOT NULL)');
  sqlite.exec('CREATE UNIQUE INDEX "option_scoped_identity" '+
    'ON "wp_options"("site_id","option_name")');
  const prepared:ProbeCall[]=[];
  const db={
    prepare(sql:string){
      return {bind(...args:(string|number|null)[]){
        prepared.push({sql,args});
        return {all:async()=>({
          success:true,results:sqlite.prepare(sql).all(...args)
        })};
      }};
    }
  } as unknown as Pick<D1Database,"prepare">;
  return {sqlite,prepared,db};
}
describe("private WordPress schema SQL family compatibility on native D1",()=>{
  test("recognizes only exact host-pinned DESCRIBE and SHOW TABLES SQL",()=>{
    for(const query of [
      "DESCRIBE wp_options","DESC wp_options","SHOW COLUMNS FROM wp_options"
    ])expect(classifyWordPressMetadataQuery(query,"wp_options")).toBe("describe");
    expect(classifyWordPressMetadataQuery("SHOW TABLES LIKE 'wp_options'","wp_options"))
      .toBe("show-tables-like");
    for(const query of [
      "DESCRIBE wp_users",
      "DESCRIBE wp_options; DROP TABLE wp_options",
      "SHOW TABLES LIKE 'wp_%'",
      "SHOW TABLES LIKE 'wp_options%'",
      "SHOW INDEX FROM wp_options",
      "SHOW FULL COLUMNS FROM wp_options",
      "PRAGMA table_info('wp_options')",
      "DESCRIBE "+String.fromCharCode(96)+"wp_options"+String.fromCharCode(96),
      "DESCRIBE wp_options -- comment",
      "DESCRIBE wp_options\u0000",
      "",
      "x".repeat(500)
    ])expect(()=>classifyWordPressMetadataQuery(query,"wp_options")).toThrow();
  });
  test("actual SQLite metadata is returned without claiming MySQL DESCRIBE semantics",async()=>{
    const f=fixture();
    const res=await readPrivateWordPressMetadata("DESCRIBE wp_options",config,f.db,access);
    expect(res.kind).toBe("describe");
    if(res.kind!=="describe")throw Error("wrong kind");
    expect(res.queryCount).toBe(1);
    expect(res.mysqlDescribeCompatible).toBe(false);
    expect(res.columns.map(c=>c.name))
      .toEqual(["site_id","option_name","option_value","autoload"]);
    expect(res.columns[0]?.declaredType).toBe("TEXT");
    expect(res.columns[0]?.notNull).toBe(true);
    expect(res.columns[1]?.primaryKeyPosition).toBe(0);
    expect(Object.isFrozen(res.columns)).toBe(true);
    expect(Object.isFrozen(res.columns[0])).toBe(true);
    expect(f.prepared).toHaveLength(1);
    expect(f.prepared[0]?.args).toEqual(["wp_options"]);
    expect(f.prepared[0]?.sql).toContain("pragma_table_info(?)");
    f.sqlite.close();
  });
  test("SHOW TABLES LIKE exact WordPress table performs one scoped prepared lookup",async()=>{
    const f=fixture();
    const res=await readPrivateWordPressMetadata(
      "SHOW TABLES LIKE 'wp_options'",config,f.db,access
    );
    expect(res).toEqual({
      kind:"show-tables-like",table:"wp_options",exists:true,
      queryCount:1,mysqlShowTablesCompatible:false
    });
    expect(f.prepared).toHaveLength(1);
    expect(f.prepared[0]?.args).toEqual(["wp_options"]);
    expect(f.prepared[0]?.sql).toContain('"name" = ? LIMIT 2');
    f.sqlite.close();
  });
  test("wrong capability, malicious query, unsupported syntax and config rejected before D1",async()=>{
    const f=fixture();
    const wrong={readSchema:true};
    for(const operation of [
      ()=>readPrivateWordPressMetadata("DESCRIBE wp_options",config,f.db,wrong),
      ()=>readPrivateWordPressMetadata("DESCRIBE wp_users",config,f.db,access),
      ()=>readPrivateWordPressMetadata("SHOW TABLES LIKE 'wp_%'",config,f.db,access),
      ()=>readPrivateWordPressMetadata("DESCRIBE wp_options; DROP TABLE x",config,f.db,access),
      ()=>readPrivateWordPressMetadata("DESCRIBE wp_options",
        {...config,table:"wp_users"} as unknown as TrustedWordPressMetadataConfig,f.db,access),
      ()=>readPrivateWordPressMetadata("DESCRIBE wp_options",
        {...config,capability:wrong},f.db,access)
    ])await expect(operation()).rejects.toThrow("Private WordPress D1 metadata rejected");
    expect(f.prepared).toHaveLength(0);
    f.sqlite.close();
  });
  test("missing, truncated or malicious D1 schema results fail closed",async()=>{
    const f=fixture();
    const badResults:Array<unknown>= [
      [],
      [{cid:0,name:"bad",type:"TEXT",notnull:1,pk:0,dflt_value:null}],
      [{cid:0,name:"option_name",type:"TEXT",notnull:1,pk:0,dflt_value:null}],
      [{cid:0,name:"option_name",type:"TEXT",notnull:1,pk:0,dflt_value:null,
        secret:"unexpected"}],
      [{cid:0,name:"option_name;DROP",type:"TEXT",notnull:1,pk:0,dflt_value:null}],
      [{cid:1,name:"option_name",type:"TEXT",notnull:1,pk:0,dflt_value:null}],
      [{cid:0,name:"option_name",type:"T".repeat(101),notnull:1,pk:0,dflt_value:null}],
      Array.from({length:MAX_METADATA_COLUMNS+1},(_,i)=>({
        cid:i,name:"c_"+i,type:"TEXT",notnull:0,pk:0,dflt_value:null
      }))
    ];
    for(const result of badResults){
      const db={prepare:()=>({bind:()=>({
        all:async()=>({success:true,results:result})
      })})} as unknown as Pick<D1Database,"prepare">;
      await expect(readPrivateWordPressMetadata(
        "DESCRIBE wp_options",config,db,access
      )).rejects.toThrow();
    }
    for(const results of [
      [{name:"wp_users"}],[{name:"wp_options"},{name:"wp_options"}],
      [{name:"wp_options",sql:"LEAK"}],null
    ]){
      const db={prepare:()=>({bind:()=>({
        all:async()=>({success:true,results})
      })})} as unknown as Pick<D1Database,"prepare">;
      await expect(readPrivateWordPressMetadata(
        "SHOW TABLES LIKE 'wp_options'",config,db,access
      )).rejects.toThrow();
    }
    const absent=await readPrivateWordPressMetadata(
      "SHOW TABLES LIKE 'wp_options'",config,{
        prepare:()=>({bind:()=>({all:async()=>({
          success:true,results:[]
        })})})
      } as unknown as Pick<D1Database,"prepare">,access
    );
    expect(absent.kind).toBe("show-tables-like");
    if(absent.kind==="show-tables-like")expect(absent.exists).toBe(false);
    f.sqlite.close();
  });
  test("unsupported table/type does not fabricate MySQL schema parity or ship to runtime",()=>{
    for(const path of [
      "src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"
    ])expect(readFileSync(path,"utf8")).not.toContain("d1-wpdb-conformance/schema-metadata");
    expect(readFileSync("wrangler.staging.jsonc","utf8"))
      .not.toContain("MICROWP_SCHEMA_METADATA_TEST");
  });
});
