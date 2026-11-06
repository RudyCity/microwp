import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  COMMENT_POST_BATCH_MAX_IDS,COMMENTMETA_BATCH_MAX_IDS,COMMENT_MAX_ROWS,
  COMMENT_TEXT_MAX_BYTES,COMMENTMETA_VALUE_MAX_BYTES,
  countPrivateApprovedCommentsByPostIds,readPrivateCommentsByPostIds,
  insertPrivateComment,readPrivateCommentMetaByCommentIds,
  type CommentInsert,type TrustedCommentConfig
} from "../src/php/d1-wpdb-conformance/comments";

const readCap=Object.freeze({read:true});
const insertCap=Object.freeze({insert:true});
const metaCap=Object.freeze({meta:true});
const config:TrustedCommentConfig={
  scope:{column:"site_id",value:"site_a"},
  capabilities:{read:readCap,insert:insertCap,metaRead:metaCap}
};
function comment(comment_ID:number,postId:number,content:string,approved="1"):CommentInsert{
  return {
    comment_ID,comment_post_ID:postId,comment_karma:0,comment_parent:0,user_id:1,
    comment_author:"Rudy",comment_author_email:"rudy@example.test",
    comment_author_url:"",comment_author_IP:"127.0.0.1",
    comment_date:"2026-11-06 00:00:00",comment_date_gmt:"2026-11-06 00:00:00",
    comment_content:content,comment_approved:approved,
    comment_agent:"microWP-test",comment_type:"comment"
  };
}
type Call={sql:string;args:(string|number|null)[]};
function fixture(){
  const sqlite=new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE wp_posts ("+
    "site_id TEXT NOT NULL,ID INTEGER NOT NULL,UNIQUE(site_id,ID));"+
    "CREATE TABLE wp_comments ("+
    "site_id TEXT NOT NULL,comment_ID INTEGER NOT NULL,comment_post_ID INTEGER NOT NULL,"+
    "comment_karma INTEGER NOT NULL,comment_parent INTEGER NOT NULL,user_id INTEGER NOT NULL,"+
    "comment_author TEXT NOT NULL,comment_author_email TEXT NOT NULL,"+
    "comment_author_url TEXT NOT NULL,comment_author_IP TEXT NOT NULL,"+
    "comment_date TEXT NOT NULL,comment_date_gmt TEXT NOT NULL,"+
    "comment_content TEXT NOT NULL,comment_approved TEXT NOT NULL,"+
    "comment_agent TEXT NOT NULL,comment_type TEXT NOT NULL,"+
    "UNIQUE(site_id,comment_ID));"+
    "CREATE TABLE wp_commentmeta ("+
    "site_id TEXT NOT NULL,meta_id INTEGER NOT NULL,comment_id INTEGER NOT NULL,"+
    "meta_key TEXT,meta_value TEXT,UNIQUE(site_id,meta_id));"
  );
  sqlite.exec("INSERT INTO wp_posts VALUES ('site_a',1),('site_a',3),('site_b',2)");
  const insert=sqlite.prepare("INSERT INTO wp_comments VALUES ("+
    Array.from({length:16},()=>"?").join(",")+")");
  insert.run("site_a",...Object.values(comment(10,1,"approved")));
  insert.run("site_a",...Object.values(comment(11,1,"pending","0")));
  insert.run("site_a",...Object.values(comment(12,3,"second approved")));
  insert.run("site_b",...Object.values(comment(10,2,"PRIVATE")));
  const meta=sqlite.prepare("INSERT INTO wp_commentmeta VALUES (?,?,?,?,?)");
  meta.run("site_a",20,10,"rating","5");
  meta.run("site_a",21,10,"empty","");
  meta.run("site_a",22,12,null,null);
  meta.run("site_b",20,10,"secret","PRIVATE");
  const calls:Call[]=[];
  const db={prepare(sql:string){return {bind(...args:(string|number|null)[]){
    calls.push({sql,args});
    return {
      all:async()=>({success:true,results:sqlite.prepare(sql).all(...args)}),
      run:async()=>{
        const r=sqlite.prepare(sql).run(...args);
        return {success:true,meta:{changes:r.changes}};
      }
    };
  }}}} as unknown as D1Database;
  return {sqlite,insert,meta,calls,db};
}
describe("private WordPress comments native D1 proof",()=>{
  test("approved comment counts are grouped, bounded and site-scoped",async()=>{
    const f=fixture();
    const rows=await countPrivateApprovedCommentsByPostIds(
      [3,2,1],["1"],config,f.db,readCap
    );
    expect(rows).toEqual([
      {comment_post_ID:1,count:1},{comment_post_ID:3,count:1}
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('COUNT(*) AS "count"');
    expect(f.calls[0]?.sql).toContain('GROUP BY "comment_post_ID"');
    expect(f.calls[0]?.sql).toContain('"comment_approved" IN (?)');
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    f.sqlite.close();
  });
  test("ordered comment read returns complete bounded site rows",async()=>{
    const f=fixture();
    const rows=await readPrivateCommentsByPostIds([3,2,1],config,f.db,readCap);
    expect(rows.map(r=>[r.comment_ID,r.comment_post_ID,r.comment_content])).toEqual([
      [10,1,"approved"],[11,1,"pending"],[12,3,"second approved"]
    ]);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('ORDER BY "comment_ID" ASC LIMIT ?');
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    f.sqlite.close();
  });
  test("comment insert requires same-site parent post and binds comment text",async()=>{
    const f=fixture();
    const malicious=comment(30,1,"hello '); DROP TABLE wp_comments; --");
    expect(await insertPrivateComment(malicious,config,f.db,insertCap))
      .toEqual({operation:"comment-insert",changed:1,queryCount:1});
    expect(f.calls.at(-1)?.sql).toContain("WHERE EXISTS");
    expect(f.calls.at(-1)?.sql).not.toContain(malicious.comment_content);
    expect(await insertPrivateComment(
      comment(31,2,"must not cross site"),config,f.db,insertCap
    )).toEqual({operation:"comment-insert",changed:0,queryCount:1});
    expect(f.sqlite.prepare(
      "SELECT comment_content FROM wp_comments WHERE site_id='site_a' AND comment_ID=30"
    ).get()).toEqual({comment_content:malicious.comment_content});
    expect(f.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM wp_comments WHERE site_id='site_a' AND comment_ID=31"
    ).get()).toEqual({n:0});
    f.sqlite.close();
  });
  test("commentmeta batch preserves nullable/empty values and excludes other site",async()=>{
    const f=fixture();
    const rows=await readPrivateCommentMetaByCommentIds(
      [12,10],config,f.db,metaCap
    );
    expect(rows).toEqual([
      {meta_id:20,comment_id:10,meta_key:"rating",meta_value:"5"},
      {meta_id:21,comment_id:10,meta_key:"empty",meta_value:""},
      {meta_id:22,comment_id:12,meta_key:null,meta_value:null}
    ]);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    expect(f.calls[0]?.sql).toContain('"comment_id" IN (?, ?)');
    expect(f.calls[0]?.sql).toContain('ORDER BY "meta_id" ASC LIMIT ?');
    f.sqlite.close();
  });
  test("bounds and capabilities fail before D1",async()=>{
    const f=fixture(),wrong={read:true};
    const calls=[
      ()=>countPrivateApprovedCommentsByPostIds([1],["1"],config,f.db,wrong),
      ()=>countPrivateApprovedCommentsByPostIds([],["1"],config,f.db,readCap),
      ()=>countPrivateApprovedCommentsByPostIds([1],[],config,f.db,readCap),
      ()=>countPrivateApprovedCommentsByPostIds([1],["1","1"],config,f.db,readCap),
      ()=>countPrivateApprovedCommentsByPostIds([1],["x".repeat(21)],config,f.db,readCap),
      ()=>readPrivateCommentsByPostIds(
        Array.from({length:COMMENT_POST_BATCH_MAX_IDS+1},(_,i)=>i+1),
        config,f.db,readCap),
      ()=>readPrivateCommentMetaByCommentIds(
        Array.from({length:COMMENTMETA_BATCH_MAX_IDS+1},(_,i)=>i+1),
        config,f.db,metaCap),
      ()=>insertPrivateComment(
        {...comment(30,1,"x"),comment_content:"x".repeat(COMMENT_TEXT_MAX_BYTES+1)},
        config,f.db,insertCap),
      ()=>insertPrivateComment(comment(30,1,"x"),config,f.db,readCap),
      ()=>readPrivateCommentsByPostIds([1],
        {...config,scope:{column:"comment_ID",value:"site_a"}},f.db,readCap)
    ];
    for(const call of calls)
      await expect(call()).rejects.toThrow("Private WordPress comment D1 operation rejected");
    expect(f.calls).toHaveLength(0);
    f.sqlite.close();
  });
  test("oversized commentmeta and comment row overflow fail closed",async()=>{
    const f=fixture();
    f.sqlite.prepare("UPDATE wp_commentmeta SET meta_value=? WHERE site_id='site_a' AND meta_id=20")
      .run("x".repeat(COMMENTMETA_VALUE_MAX_BYTES+1));
    await expect(readPrivateCommentMetaByCommentIds([10],config,f.db,metaCap))
      .rejects.toThrow();
    f.sqlite.close();

    const many=fixture();
    for(let i=0;i<=COMMENT_MAX_ROWS;i++)
      many.insert.run("site_a",...Object.values(comment(1000+i,1,"c"+i)));
    await expect(readPrivateCommentsByPostIds([1],config,many.db,readCap))
      .rejects.toThrow();
    many.sqlite.close();
  });
  test("comments proof remains absent from active WordPress database path",()=>{
    for(const path of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"])
      expect(readFileSync(path,"utf8")).not.toContain("d1-wpdb-conformance/comments");
  });
});
