import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  insertPrivateCorePost,updatePrivateCorePost,
  insertPrivatePostMeta,updatePrivatePostMeta,deletePrivatePostMeta,
  POST_WRITE_TEXT_MAX_BYTES,POSTMETA_WRITE_VALUE_MAX_BYTES,
  type CorePostInsert,type TrustedCoreWriteConfig
} from "../src/php/d1-wpdb-conformance/core-mutations";

const caps={
  postInsert:Object.freeze({op:"post-insert"}),
  postUpdate:Object.freeze({op:"post-update"}),
  postMetaInsert:Object.freeze({op:"meta-insert"}),
  postMetaUpdate:Object.freeze({op:"meta-update"}),
  postMetaDelete:Object.freeze({op:"meta-delete"})
};
const config:TrustedCoreWriteConfig={
  scope:{column:"site_id",value:"site_a"},capabilities:caps
};
function post(ID:number,title="Inserted"):CorePostInsert{
  return {
    ID,post_author:7,post_parent:0,menu_order:0,comment_count:0,
    post_date:"2026-11-06 00:00:00",post_date_gmt:"2026-11-06 00:00:00",
    post_content:"body",post_title:title,post_excerpt:"",post_status:"draft",
    comment_status:"open",ping_status:"open",post_password:"",post_name:"inserted-"+ID,
    to_ping:"",pinged:"",post_modified:"2026-11-06 00:00:00",
    post_modified_gmt:"2026-11-06 00:00:00",post_content_filtered:"",
    guid:"https://example.test/?p="+ID,post_type:"post",post_mime_type:""
  };
}
type Call={sql:string;args:(string|number|null)[]};
function fixture(){
  const sqlite=new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE wp_posts ("+
    "site_id TEXT NOT NULL,ID INTEGER NOT NULL,post_author INTEGER NOT NULL,"+
    "post_parent INTEGER NOT NULL,menu_order INTEGER NOT NULL,comment_count INTEGER NOT NULL,"+
    "post_date TEXT NOT NULL,post_date_gmt TEXT NOT NULL,post_content TEXT NOT NULL,"+
    "post_title TEXT NOT NULL,post_excerpt TEXT NOT NULL,post_status TEXT NOT NULL,"+
    "comment_status TEXT NOT NULL,ping_status TEXT NOT NULL,post_password TEXT NOT NULL,"+
    "post_name TEXT NOT NULL,to_ping TEXT NOT NULL,pinged TEXT NOT NULL,"+
    "post_modified TEXT NOT NULL,post_modified_gmt TEXT NOT NULL,"+
    "post_content_filtered TEXT NOT NULL,guid TEXT NOT NULL,post_type TEXT NOT NULL,"+
    "post_mime_type TEXT NOT NULL,UNIQUE(site_id,ID));"+
    "CREATE TABLE wp_postmeta ("+
    "site_id TEXT NOT NULL,meta_id INTEGER NOT NULL,post_id INTEGER NOT NULL,"+
    "meta_key TEXT,meta_value TEXT,UNIQUE(site_id,meta_id));"
  );
  const insert=sqlite.prepare("INSERT INTO wp_posts VALUES ("+
    Array.from({length:24},()=>"?").join(",")+")");
  const a=post(1,"A"),b=post(2,"PRIVATE B");
  insert.run("site_a",...Object.values(a));
  insert.run("site_b",...Object.values(b));
  const calls:Call[]=[];
  const db={prepare(sql:string){return {bind(...args:(string|number|null)[]){
    calls.push({sql,args});
    return {run:async()=>{
      const r=sqlite.prepare(sql).run(...args);
      return {success:true,meta:{changes:r.changes}};
    }};
  }}}} as unknown as D1Database;
  return {sqlite,calls,db};
}
describe("private WordPress posts/postmeta native D1 writes",()=>{
  test("post insert is one prepared scoped statement with no raw payload in SQL",async()=>{
    const f=fixture(),value=post(5,"title '); DROP TABLE wp_posts; --");
    expect(await insertPrivateCorePost(value,config,f.db,caps.postInsert))
      .toEqual({operation:"post-insert",changed:1,queryCount:1});
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('INSERT INTO "wp_posts"');
    expect(f.calls[0]?.sql).not.toContain(value.post_title);
    expect(f.calls[0]?.args[0]).toBe("site_a");
    expect(f.sqlite.prepare(
      "SELECT site_id,post_title FROM wp_posts WHERE ID=5"
    ).get()).toEqual({site_id:"site_a",post_title:value.post_title});
    expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM wp_posts").get() as {n:number}).n)
      .toBe(3);
    f.sqlite.close();
  });
  test("post update changes only approved columns in trusted site",async()=>{
    const f=fixture();
    expect(await updatePrivateCorePost(1,{
      post_title:"Revised",post_status:"publish",comment_count:4
    },config,f.db,caps.postUpdate)).toEqual({
      operation:"post-update",changed:1,queryCount:1
    });
    expect(await updatePrivateCorePost(2,{
      post_title:"Must not touch B"
    },config,f.db,caps.postUpdate)).toEqual({
      operation:"post-update",changed:0,queryCount:1
    });
    expect(f.sqlite.prepare(
      "SELECT post_title,post_status,comment_count FROM wp_posts "+
      "WHERE site_id='site_a' AND ID=1"
    ).get()).toEqual({post_title:"Revised",post_status:"publish",comment_count:4});
    expect(f.sqlite.prepare(
      "SELECT post_title FROM wp_posts WHERE site_id='site_b' AND ID=2"
    ).get()).toEqual({post_title:"PRIVATE B"});
    f.sqlite.close();
  });
  test("postmeta insert requires a parent post in the same site in one statement",async()=>{
    const f=fixture();
    expect(await insertPrivatePostMeta({
      meta_id:20,post_id:1,meta_key:"color",meta_value:"blue"
    },config,f.db,caps.postMetaInsert)).toEqual({
      operation:"postmeta-insert",changed:1,queryCount:1
    });
    expect(await insertPrivatePostMeta({
      meta_id:21,post_id:2,meta_key:"secret",meta_value:"must-not-write"
    },config,f.db,caps.postMetaInsert)).toEqual({
      operation:"postmeta-insert",changed:0,queryCount:1
    });
    expect(f.calls[0]?.sql).toContain("WHERE EXISTS");
    expect(f.calls[0]?.sql).toContain('"site_id" = ? AND "ID" = ?');
    expect(f.sqlite.prepare("SELECT * FROM wp_postmeta ORDER BY meta_id").all())
      .toEqual([{site_id:"site_a",meta_id:20,post_id:1,meta_key:"color",meta_value:"blue"}]);
    f.sqlite.close();
  });
  test("postmeta update/delete remain identity- and site-scoped",async()=>{
    const f=fixture();
    f.sqlite.prepare("INSERT INTO wp_postmeta VALUES (?,?,?,?,?)")
      .run("site_a",20,1,"color","blue");
    f.sqlite.prepare("INSERT INTO wp_postmeta VALUES (?,?,?,?,?)")
      .run("site_b",20,2,"color","PRIVATE");
    expect(await updatePrivatePostMeta(20,{
      meta_key:null,meta_value:"green"
    },config,f.db,caps.postMetaUpdate)).toEqual({
      operation:"postmeta-update",changed:1,queryCount:1
    });
    expect(f.sqlite.prepare(
      "SELECT meta_key,meta_value FROM wp_postmeta WHERE site_id='site_a' AND meta_id=20"
    ).get()).toEqual({meta_key:null,meta_value:"green"});
    expect(f.sqlite.prepare(
      "SELECT meta_value FROM wp_postmeta WHERE site_id='site_b' AND meta_id=20"
    ).get()).toEqual({meta_value:"PRIVATE"});
    expect(await deletePrivatePostMeta(20,config,f.db,caps.postMetaDelete)).toEqual({
      operation:"postmeta-delete",changed:1,queryCount:1
    });
    expect(f.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM wp_postmeta WHERE site_id='site_a'"
    ).get()).toEqual({n:0});
    expect(f.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM wp_postmeta WHERE site_id='site_b'"
    ).get()).toEqual({n:1});
    f.sqlite.close();
  });
  test("wrong capabilities, malformed posts and dangerous patches fail before D1",async()=>{
    const f=fixture(),wrong={op:"post-insert"};
    const operations=[
      ()=>insertPrivateCorePost(post(6),config,f.db,wrong),
      ()=>insertPrivateCorePost({...post(6),ID:0},config,f.db,caps.postInsert),
      ()=>insertPrivateCorePost(
        {...post(6),post_content:"x".repeat(POST_WRITE_TEXT_MAX_BYTES+1)},
        config,f.db,caps.postInsert),
      ()=>insertPrivateCorePost(
        {...post(6),site_id:"site_b"} as unknown as CorePostInsert,
        config,f.db,caps.postInsert),
      ()=>updatePrivateCorePost(1,{},config,f.db,caps.postUpdate),
      ()=>updatePrivateCorePost(1,{ID:5} as never,config,f.db,caps.postUpdate),
      ()=>updatePrivateCorePost(1,{site_id:"site_b"} as never,config,f.db,caps.postUpdate),
      ()=>insertPrivatePostMeta({
        meta_id:20,post_id:1,meta_key:"x",
        meta_value:"x".repeat(POSTMETA_WRITE_VALUE_MAX_BYTES+1)
      },config,f.db,caps.postMetaInsert),
      ()=>updatePrivatePostMeta(20,{post_id:2} as never,config,f.db,caps.postMetaUpdate),
      ()=>deletePrivatePostMeta(20,config,f.db,caps.postMetaUpdate),
      ()=>insertPrivateCorePost(post(6),{
        ...config,scope:{column:"ID",value:"site_a"}
      },f.db,caps.postInsert)
    ];
    for(const operation of operations)
      await expect(operation()).rejects.toThrow("Private WordPress core D1 write rejected");
    expect(f.calls).toHaveLength(0);
    f.sqlite.close();
  });
  test("duplicate identity and malformed D1 changes fail closed",async()=>{
    const f=fixture();
    await expect(insertPrivateCorePost(post(1),config,f.db,caps.postInsert))
      .rejects.toThrow();
    f.sqlite.close();
    for(const meta of [{changes:2},{changes:-1},{changes:1.5},{changes:"1"},{}]){
      const db=({prepare:()=>({bind:()=>({run:async()=>({success:true,meta})})})}) as unknown as D1Database;
      await expect(updatePrivateCorePost(
        1,{post_title:"x"},config,db,caps.postUpdate
      )).rejects.toThrow();
    }
  });
  test("post DELETE is intentionally absent until dependent data cascade is proven",()=>{
    const source=readFileSync(
      "src/php/d1-wpdb-conformance/core-mutations.ts","utf8"
    );
    expect(source).not.toContain("deletePrivateCorePost");
    expect(source).not.toContain('DELETE FROM "wp_posts"');
    for(const path of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"])
      expect(readFileSync(path,"utf8"))
        .not.toContain("d1-wpdb-conformance/core-mutations");
  });
});
