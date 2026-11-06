import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  TAXONOMY_OBJECT_MAX_IDS,TAXONOMY_MAX_NAMES,TAXONOMY_MAX_ROWS,
  TAXONOMY_DESCRIPTION_MAX_BYTES,readPrivateObjectTerms,
  type TrustedTaxonomyReadConfig
} from "../src/php/d1-wpdb-conformance/taxonomy-reads";

const cap=Object.freeze({taxonomy:true});
const config:TrustedTaxonomyReadConfig={
  scope:{column:"site_id",value:"site_a"},capability:cap
};
type Call={sql:string;args:(string|number|null)[]};
function fixture(){
  const sqlite=new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE wp_terms ("+
    "site_id TEXT NOT NULL,term_id INTEGER NOT NULL,name TEXT NOT NULL,slug TEXT NOT NULL,"+
    "UNIQUE(site_id,term_id));"+
    "CREATE TABLE wp_term_taxonomy ("+
    "site_id TEXT NOT NULL,term_taxonomy_id INTEGER NOT NULL,term_id INTEGER NOT NULL,"+
    "taxonomy TEXT NOT NULL,description TEXT NOT NULL,parent INTEGER NOT NULL,count INTEGER NOT NULL,"+
    "UNIQUE(site_id,term_taxonomy_id));"+
    "CREATE TABLE wp_term_relationships ("+
    "site_id TEXT NOT NULL,object_id INTEGER NOT NULL,term_taxonomy_id INTEGER NOT NULL,"+
    "term_order INTEGER NOT NULL,UNIQUE(site_id,object_id,term_taxonomy_id));"
  );
  const term=sqlite.prepare("INSERT INTO wp_terms VALUES (?,?,?,?)");
  const tt=sqlite.prepare("INSERT INTO wp_term_taxonomy VALUES (?,?,?,?,?,?,?)");
  const rel=sqlite.prepare("INSERT INTO wp_term_relationships VALUES (?,?,?,?)");
  term.run("site_a",1,"News","news");
  term.run("site_a",2,"Featured","featured");
  term.run("site_b",1,"PRIVATE","private");
  tt.run("site_a",10,1,"category","News category",0,2);
  tt.run("site_a",11,2,"post_tag","Featured tag",0,1);
  tt.run("site_b",10,1,"category","PRIVATE",0,1);
  rel.run("site_a",1,10,0);
  rel.run("site_a",1,11,1);
  rel.run("site_a",3,10,0);
  rel.run("site_b",2,10,0);
  const calls:Call[]=[];
  const db={prepare(sql:string){return {bind(...args:(string|number|null)[]){
    calls.push({sql,args});
    return {all:async()=>({success:true,results:sqlite.prepare(sql).all(...args)})};
  }}}} as unknown as D1Database;
  return {sqlite,term,tt,rel,calls,db};
}
describe("private WordPress taxonomy three-table native D1 read",()=>{
  test("fixed DISTINCT JOIN returns only site-scoped category/tag rows",async()=>{
    const f=fixture();
    const rows=await readPrivateObjectTerms(
      [3,2,1],["category","post_tag"],config,f.db,cap
    );
    expect(rows).toEqual([
      {object_id:1,term_id:1,name:"News",slug:"news",term_taxonomy_id:10,
       taxonomy:"category",description:"News category",parent:0,count:2,term_order:0},
      {object_id:1,term_id:2,name:"Featured",slug:"featured",term_taxonomy_id:11,
       taxonomy:"post_tag",description:"Featured tag",parent:0,count:1,term_order:1},
      {object_id:3,term_id:1,name:"News",slug:"news",term_taxonomy_id:10,
       taxonomy:"category",description:"News category",parent:0,count:2,term_order:0}
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('SELECT DISTINCT');
    expect(f.calls[0]?.sql).toContain('INNER JOIN "wp_term_taxonomy"');
    expect(f.calls[0]?.sql).toContain('INNER JOIN "wp_terms"');
    expect(f.calls[0]?.sql).toContain('"object_id" IN (?, ?, ?)');
    expect(f.calls[0]?.sql).toContain('"taxonomy" IN (?, ?)');
    expect(f.calls[0]?.sql).toContain(
      'ORDER BY tr."object_id" ASC, t."term_id" ASC, tt."term_taxonomy_id" ASC LIMIT ?'
    );
    f.sqlite.close();
  });
  test("max 16 object IDs and 8 taxonomy names stay below D1 bind cap",async()=>{
    const f=fixture();
    const objects=Array.from({length:TAXONOMY_OBJECT_MAX_IDS},(_,i)=>i+1);
    const taxonomies=Array.from({length:TAXONOMY_MAX_NAMES},(_,i)=>"tax_"+i);
    const rows=await readPrivateObjectTerms(objects,taxonomies,config,f.db,cap);
    expect(rows).toEqual([]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.args.length).toBe(4+3+16+8+1);
    f.sqlite.close();
  });
  test("wrong capability, malformed IDs/taxonomy names and bad scope fail before D1",async()=>{
    const f=fixture();
    const wrong={taxonomy:true};
    const calls=[
      ()=>readPrivateObjectTerms([1],["category"],config,f.db,wrong),
      ()=>readPrivateObjectTerms([],["category"],config,f.db,cap),
      ()=>readPrivateObjectTerms([1],[],config,f.db,cap),
      ()=>readPrivateObjectTerms([1,1],["category"],config,f.db,cap),
      ()=>readPrivateObjectTerms([0],["category"],config,f.db,cap),
      ()=>readPrivateObjectTerms(new Array(1) as number[],["category"],config,f.db,cap),
      ()=>readPrivateObjectTerms([1],new Array(1) as string[],config,f.db,cap),
      ()=>readPrivateObjectTerms([1],["Category"],config,f.db,cap),
      ()=>readPrivateObjectTerms([1],["category","category"],config,f.db,cap),
      ()=>readPrivateObjectTerms(
        Array.from({length:TAXONOMY_OBJECT_MAX_IDS+1},(_,i)=>i+1),
        ["category"],config,f.db,cap),
      ()=>readPrivateObjectTerms([1],
        Array.from({length:TAXONOMY_MAX_NAMES+1},(_,i)=>"tax_"+i),config,f.db,cap),
      ()=>readPrivateObjectTerms([1],["category"],
        {...config,scope:{column:"term_id",value:"site_a"}},f.db,cap),
      ()=>readPrivateObjectTerms([1],["category"],
        {...config,capability:wrong},f.db,cap)
    ];
    for(const call of calls)
      await expect(call()).rejects.toThrow("Private WordPress taxonomy D1 read rejected");
    expect(f.calls).toHaveLength(0);
    f.sqlite.close();
  });
  test("oversized description and row overflow fail without partial taxonomy data",async()=>{
    const f=fixture();
    f.sqlite.prepare("UPDATE wp_term_taxonomy SET description=? WHERE site_id='site_a' AND term_taxonomy_id=10")
      .run("x".repeat(TAXONOMY_DESCRIPTION_MAX_BYTES+1));
    await expect(readPrivateObjectTerms(
      [1],["category"],config,f.db,cap
    )).rejects.toThrow();
    f.sqlite.close();

    const many=fixture();
    for(let i=0;i<=TAXONOMY_MAX_ROWS;i++){
      const termId=1000+i,ttId=2000+i;
      many.term.run("site_a",termId,"Term "+i,"term-"+i);
      many.tt.run("site_a",ttId,termId,"category","",0,1);
      many.rel.run("site_a",1,ttId,i);
    }
    await expect(readPrivateObjectTerms(
      [1],["category"],config,many.db,cap
    )).rejects.toThrow();
    many.sqlite.close();
  });
  test("malformed or cross-object results are rejected",async()=>{
    const base={
      object_id:1,term_id:1,name:"News",slug:"news",term_taxonomy_id:10,
      taxonomy:"category",description:"",parent:0,count:1,term_order:0
    };
    for(const results of [
      [{...base,secret:"leak"}],
      [{...base,object_id:99}],
      [{...base,taxonomy:"private"}],
      [{...base,term_id:2,term_taxonomy_id:11},{...base,term_id:1,term_taxonomy_id:10}],
      [{...base},{...base}]
    ]){
      const db=({prepare:()=>({bind:()=>({all:async()=>({success:true,results})})})}) as unknown as D1Database;
      await expect(readPrivateObjectTerms(
        [1],["category"],config,db,cap
      )).rejects.toThrow();
    }
  });
  test("taxonomy proof is absent from live WordPress database path",()=>{
    for(const path of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"])
      expect(readFileSync(path,"utf8")).not.toContain("d1-wpdb-conformance/taxonomy-reads");
  });
});
