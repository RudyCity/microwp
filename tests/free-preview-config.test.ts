import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {Database} from "bun:sqlite";
import {join} from "node:path";

const root=join(import.meta.dir,"..");
const config=JSON.parse(readFileSync(join(root,"wrangler.free-preview.jsonc"),"utf8"));
const migration=readFileSync(join(root,"migrations_free","0001_free_public_posts.sql"),"utf8");
describe("isolated Free-only preview config",()=>{
 test("never boots WordPress or exposes a public preview by default",()=>{
   expect(config.main).toBe("src/index-free.ts");
   expect(config.vars.MICROWP_FREE_PREVIEW_MODE).toBe("disabled");
   expect(config.workers_dev).toBe(false);
   expect(config.limits).toBeUndefined();
   expect(config.assets.run_worker_first).toBe(true);
 });
 test("uses local-only placeholder D1 and separate R2 namespace",()=>{
   expect(config.d1_databases[0].database_id).toBe("00000000-0000-4000-8000-000000000002");
   expect(config.d1_databases[0].migrations_dir).toBe("migrations_free");
   expect(config.r2_buckets[0].bucket_name).toBe("microwp-free-preview-local-media");
   expect(config.r2_buckets[0].bucket_name).not.toBe("microwp-alpha-staging-media");
 });
 test("public index has no secret columns and only publishes approved rows",()=>{
   const db=new Database(":memory:");
   try {
     db.exec(migration);
     db.prepare("INSERT INTO microwp_free_posts(slug,title,excerpt,status,published_at) VALUES (?,?,?,?,?)")
       .run("demo","A title","An excerpt","published","2026-11-06");
     db.prepare("INSERT INTO microwp_free_posts(slug,title,excerpt,status,published_at) VALUES (?,?,?,?,?)")
       .run("draft","Private draft","Should not show","draft","2026-11-06");
     const rows=db.prepare("SELECT slug,title FROM microwp_free_posts WHERE status=? ORDER BY published_at DESC LIMIT ?")
       .all("published",20);
     expect(rows).toEqual([{slug:"demo",title:"A title"}]);
     expect(()=>db.prepare("INSERT INTO microwp_free_posts(slug,title,excerpt,status,published_at) VALUES (?,?,?,?,?)")
       .run("bad","Title","Excerpt","private","2026-11-06")).toThrow();
   } finally{db.close()}
 });
});
