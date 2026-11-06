import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  CORE_POST_BATCH_MAX_IDS,CORE_POSTMETA_BATCH_MAX_IDS,CORE_POSTMETA_MAX_ROWS,
  CORE_POST_VALUE_MAX_BYTES,CORE_POSTMETA_VALUE_MAX_BYTES,
  readPrivateCorePostsByIds,readPrivatePostMetaByPostIds,
  type TrustedCoreReadConfig
} from "../src/php/d1-wpdb-conformance/core-reads";

const postsCap=Object.freeze({posts:true});
const metaCap=Object.freeze({meta:true});
const config:TrustedCoreReadConfig={
  scope:{column:"site_id",value:"site_a"},
  postsCapability:postsCap,postMetaCapability:metaCap
};
type Call={sql:string;args:(string|number|null)[]};
function postValues(id:number,title:string,content:string,status="publish"){
  return [id,7,"2026-11-06 00:00:00","2026-11-06 00:00:00",content,title,"",
    status,"open","open","","post-"+id,"","","2026-11-06 00:00:00",
    "2026-11-06 00:00:00","",0,"https://example.test/?p="+id,0,"post","",0] as const;
}
function fixture(){
  const sqlite=new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE wp_posts ("+
    "site_id TEXT NOT NULL,ID INTEGER NOT NULL,post_author INTEGER NOT NULL,"+
    "post_date TEXT NOT NULL,post_date_gmt TEXT NOT NULL,post_content TEXT NOT NULL,"+
    "post_title TEXT NOT NULL,post_excerpt TEXT NOT NULL,post_status TEXT NOT NULL,"+
    "comment_status TEXT NOT NULL,ping_status TEXT NOT NULL,post_password TEXT NOT NULL,"+
    "post_name TEXT NOT NULL,to_ping TEXT NOT NULL,pinged TEXT NOT NULL,"+
    "post_modified TEXT NOT NULL,post_modified_gmt TEXT NOT NULL,"+
    "post_content_filtered TEXT NOT NULL,post_parent INTEGER NOT NULL,guid TEXT NOT NULL,"+
    "menu_order INTEGER NOT NULL,post_type TEXT NOT NULL,post_mime_type TEXT NOT NULL,"+
    "comment_count INTEGER NOT NULL,UNIQUE(site_id,ID));"+
    "CREATE TABLE wp_postmeta ("+
    "site_id TEXT NOT NULL,meta_id INTEGER NOT NULL,post_id INTEGER NOT NULL,"+
    "meta_key TEXT,meta_value TEXT,UNIQUE(site_id,meta_id));"
  );
  const posts=sqlite.prepare("INSERT INTO wp_posts VALUES ("+
    Array.from({length:24},()=>"?").join(",")+")");
  const meta=sqlite.prepare("INSERT INTO wp_postmeta VALUES (?,?,?,?,?)");
  posts.run("site_a",...postValues(1,"Alpha","content A"));
  posts.run("site_a",...postValues(3,"Gamma","content G","draft"));
  posts.run("site_b",...postValues(2,"PRIVATE B","secret B"));
  meta.run("site_a",10,1,"color","blue");
  meta.run("site_a",11,1,"empty","");
  meta.run("site_a",12,3,null,null);
  meta.run("site_b",10,2,"secret","PRIVATE");
  const calls:Call[]=[];
  const db={prepare(sql:string){return {bind(...args:(string|number|null)[]){
    calls.push({sql,args});
    return {all:async()=>({success:true,results:sqlite.prepare(sql).all(...args)})};
  }}}} as unknown as D1Database;
  return {sqlite,posts,meta,calls,db};
}
describe("private site-scoped WordPress posts/postmeta D1 reads",()=>{
  test("post ID batch returns complete core rows in one prepared scoped query",async()=>{
    const f=fixture();
    const rows=await readPrivateCorePostsByIds([3,2,1],config,f.db,postsCap);
    expect(rows.map(r=>r.ID)).toEqual([1,3]);
    expect(rows.map(r=>r.post_title)).toEqual(["Alpha","Gamma"]);
    expect(rows.some(r=>r.post_title==="PRIVATE B")).toBe(false);
    expect(rows[0]?.post_content).toBe("content A");
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('"site_id" = ? AND "ID" IN (?, ?, ?)');
    expect(f.calls[0]?.sql).toContain('ORDER BY "ID" ASC LIMIT ?');
    expect(f.calls[0]?.sql).not.toContain("content A");
    expect(f.calls[0]?.args.slice(-5)).toEqual(["site_a",3,2,1,4]);
    f.sqlite.close();
  });
  test("post batch upper bound is 16 IDs and remains one D1 statement",async()=>{
    const f=fixture();
    for(let id=4;id<=CORE_POST_BATCH_MAX_IDS;id++)
      f.posts.run("site_a",...postValues(id,"P"+id,"body"+id));
    const ids=Array.from({length:CORE_POST_BATCH_MAX_IDS},(_,i)=>i+1);
    const rows=await readPrivateCorePostsByIds(ids,config,f.db,postsCap);
    expect(rows).toHaveLength(15);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.args.length).toBe(18+1+16+1);
    f.sqlite.close();
  });
  test("postmeta mirrors bounded meta-cache IN/order shape without site leakage",async()=>{
    const f=fixture();
    const rows=await readPrivatePostMetaByPostIds([3,2,1],config,f.db,metaCap);
    expect(rows).toEqual([
      {meta_id:10,post_id:1,meta_key:"color",meta_value:"blue"},
      {meta_id:11,post_id:1,meta_key:"empty",meta_value:""},
      {meta_id:12,post_id:3,meta_key:null,meta_value:null}
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('"post_id" IN (?, ?, ?)');
    expect(f.calls[0]?.sql).toContain('ORDER BY "meta_id" ASC LIMIT ?');
    expect(f.calls[0]?.args.slice(-5)).toEqual(["site_a",3,2,1,CORE_POSTMETA_MAX_ROWS+1]);
    f.sqlite.close();
  });
  test("postmeta accepts 32 requested IDs in one query under bind limit",async()=>{
    const f=fixture();
    const ids=Array.from({length:CORE_POSTMETA_BATCH_MAX_IDS},(_,i)=>i+1);
    const rows=await readPrivatePostMetaByPostIds(ids,config,f.db,metaCap);
    expect(rows).toHaveLength(3);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.args.length).toBe(2+1+32+1);
    f.sqlite.close();
  });
  test("wrong capabilities and malformed ID lists fail before D1",async()=>{
    const f=fixture();
    const calls=[
      ()=>readPrivateCorePostsByIds([1],config,f.db,metaCap),
      ()=>readPrivatePostMetaByPostIds([1],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds([],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds([1,1],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds([0],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds([-1],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds([1.5],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds(new Array(1) as number[],config,f.db,postsCap),
      ()=>readPrivateCorePostsByIds(
        Array.from({length:CORE_POST_BATCH_MAX_IDS+1},(_,i)=>i+1),config,f.db,postsCap),
      ()=>readPrivatePostMetaByPostIds(
        Array.from({length:CORE_POSTMETA_BATCH_MAX_IDS+1},(_,i)=>i+1),config,f.db,metaCap),
      ()=>readPrivateCorePostsByIds([1],
        {...config,scope:{column:"ID",value:"site_a"}},f.db,postsCap),
      ()=>readPrivateCorePostsByIds([1],
        {...config,postsCapability:metaCap},f.db,postsCap)
    ];
    for(const call of calls)
      await expect(call()).rejects.toThrow("Private WordPress core D1 read rejected");
    expect(f.calls).toHaveLength(0);
    f.sqlite.close();
  });
  test("oversized values and overflow rows refuse partial results",async()=>{
    const f=fixture();
    f.sqlite.prepare("UPDATE wp_posts SET post_content=? WHERE site_id='site_a' AND ID=1")
      .run("x".repeat(CORE_POST_VALUE_MAX_BYTES+1));
    await expect(readPrivateCorePostsByIds([1],config,f.db,postsCap)).rejects.toThrow();
    f.sqlite.prepare("UPDATE wp_posts SET post_content='safe' WHERE site_id='site_a' AND ID=1").run();
    f.sqlite.prepare("UPDATE wp_postmeta SET meta_value=? WHERE site_id='site_a' AND meta_id=10")
      .run("x".repeat(CORE_POSTMETA_VALUE_MAX_BYTES+1));
    await expect(readPrivatePostMetaByPostIds([1],config,f.db,metaCap)).rejects.toThrow();
    f.sqlite.close();

    const tooMany=fixture();
    for(let i=0;i<=CORE_POSTMETA_MAX_ROWS;i++)
      tooMany.meta.run("site_a",1000+i,1,"k"+i,"v");
    await expect(readPrivatePostMetaByPostIds([1],config,tooMany.db,metaCap)).rejects.toThrow();
    tooMany.sqlite.close();
  });
  test("malformed D1 results cannot invent posts, metadata or hidden columns",async()=>{
    const complete=Object.fromEntries([
      ["ID",1],["post_author",1],["post_date",""],["post_date_gmt",""],
      ["post_content","x"],["post_title","x"],["post_excerpt",""],
      ["post_status","publish"],["comment_status","open"],["ping_status","open"],
      ["post_password",""],["post_name","x"],["to_ping",""],["pinged",""],
      ["post_modified",""],["post_modified_gmt",""],["post_content_filtered",""],
      ["post_parent",0],["guid",""],["menu_order",0],["post_type","post"],
      ["post_mime_type",""],["comment_count",0]
    ]);
    for(const results of [
      [{ID:1}],
      [{...complete,secret:"leak"}],
      [{...complete,ID:99}],
      [{...complete},{...complete}]
    ]){
      const db=({prepare:()=>({bind:()=>({all:async()=>({success:true,results})})})}) as unknown as D1Database;
      await expect(readPrivateCorePostsByIds([1],config,db,postsCap)).rejects.toThrow();
    }
    for(const results of [
      [{meta_id:10,post_id:1,meta_key:"x",meta_value:"v",secret:"leak"}],
      [{meta_id:10,post_id:99,meta_key:"x",meta_value:"v"}],
      [{meta_id:11,post_id:1,meta_key:"x",meta_value:"v"},
       {meta_id:10,post_id:1,meta_key:"x",meta_value:"v"}]
    ]){
      const db=({prepare:()=>({bind:()=>({all:async()=>({success:true,results})})})}) as unknown as D1Database;
      await expect(readPrivatePostMetaByPostIds([1],config,db,metaCap)).rejects.toThrow();
    }
  });
  test("new readers are absent from live WordPress database path",()=>{
    for(const path of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"])
      expect(readFileSync(path,"utf8")).not.toContain("d1-wpdb-conformance/core-reads");
  });
});
