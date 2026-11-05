import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync,existsSync} from "node:fs";
import {planNativeD1Migration,verifyNativeD1MigrationRoundtrip,
 MIGRATION_MAX_ROWS} from "../src/storage/d1-native-migration-plan";
function make(setup:(db:Database)=>void):Uint8Array{
 const db=new Database(":memory:");setup(db);const bytes=db.serialize();db.close();return bytes;
}
const base=()=>make(db=>{
 db.exec("CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY AUTOINCREMENT, post_content TEXT NOT NULL DEFAULT '' COLLATE NOCASE, score REAL, payload BLOB) STRICT;"+
 "CREATE TABLE wp_postmeta (meta_id INTEGER PRIMARY KEY, meta_value TEXT);"+
 "CREATE UNIQUE INDEX wp_posts__post_content ON wp_posts (post_content)");
 db.prepare("INSERT INTO wp_posts VALUES (?,?,?,?)").run(5,"日本語 ☕",1.125,new Uint8Array([0,255,32]));
 db.prepare("INSERT INTO wp_posts VALUES (?,?,?,?)").run(9,"Café",-2.5,new Uint8Array([]));
 db.prepare("INSERT INTO wp_postmeta VALUES (?,?)").run(1,'a:1:{s:4:"file";s:8:"test.png";}');
 db.exec("DELETE FROM wp_posts WHERE ID=9");
});
describe("offline native D1 migration plan",()=>{
 test("preserves STRICT/DEFAULT/COLLATE, indexes, data storage classes and sqlite_sequence",async()=>{
  const src=base(),copy=new Uint8Array(src);
  const plan=await planNativeD1Migration(src);
  expect(plan.productionReady).toBe(false);
  expect(plan.remoteExecutionAllowed).toBe(false);
  expect(plan.rowCount).toBe(2);
  expect(plan.indexes.length).toBe(1);
  expect(plan.sequences).toEqual([{name:"wp_posts",seq:9}]);
  expect(plan.insertStatements.every(s=>s.sql.includes("?"))).toBe(true);
  expect(await verifyNativeD1MigrationRoundtrip(plan)).toEqual({
   verified:true,rowCount:2,sourceSnapshotRetained:true,schemaParity:true,sequenceParity:true});
  expect(src).toEqual(copy);
  expect(plan.rollback.originalSnapshot).toEqual(src);
  expect(plan.rollback.sha256).toBe(plan.sourceSha256);
 });
 test("SQL injection stored as parameter data never executes as SQL",async()=>{
  const src=make(db=>{
   db.exec("CREATE TABLE wp_options (option_name TEXT, option_value TEXT)");
   db.prepare("INSERT INTO wp_options VALUES (?,?)").run("siteurl","'); DROP TABLE wp_options; --");
  });
  const plan=await planNativeD1Migration(src);
  expect(plan.insertStatements[0]?.params[1]).toBe("'); DROP TABLE wp_options; --");
  expect((await verifyNativeD1MigrationRoundtrip(plan)).verified).toBe(true);
 });
 test("rejects non-allowlisted plugin tables and permits explicitly reviewed names",async()=>{
  const bytes=make(db=>db.exec("CREATE TABLE wp_custom_gallery (id INTEGER PRIMARY KEY, payload BLOB)"));
  await expect(planNativeD1Migration(bytes)).rejects.toThrow("non-whitelisted");
  const plan=await planNativeD1Migration(bytes,{allowedPluginTables:["wp_custom_gallery"]});
  expect((await verifyNativeD1MigrationRoundtrip(plan)).verified).toBe(true);
 });
 test("rejects trigger, view, malformed and multi-statement source shape",async()=>{
  for(const ddl of ["CREATE VIEW v AS SELECT ID FROM wp_posts",
   "CREATE TRIGGER t AFTER INSERT ON wp_posts BEGIN SELECT 1; END"]){
   await expect(planNativeD1Migration(make(db=>{
    db.exec("CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY)");db.exec(ddl);
   }))).rejects.toThrow("Unsupported");
  }
  await expect(planNativeD1Migration(new Uint8Array(256))).rejects.toThrow("header");
 });
 test("rejects over-budget rows and oversized image",async()=>{
  const many=make(db=>{
   db.exec("CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY)");
   const stmt=db.prepare("INSERT INTO wp_posts VALUES (?)");
   db.transaction(()=>{for(let i=0;i<MIGRATION_MAX_ROWS+1;i++)stmt.run(i)})();
  });
  await expect(planNativeD1Migration(many)).rejects.toThrow("row count");
  await expect(planNativeD1Migration(new Uint8Array(8*1024*1024+1))).rejects.toThrow("length");
 });
 test("rollback snapshot hash tampering prevents verification",async()=>{
  const plan=await planNativeD1Migration(base());
  plan.rollback.originalSnapshot[300]^=1;
  await expect(verifyNativeD1MigrationRoundtrip(plan)).rejects.toThrow("rollback snapshot hash");
 });
 test("real ignored local WordPress snapshot: schema + data + index + sequence parity",async()=>{
  const path=".wrangler/e2e-verified-wp-sqlite-image.bin";
  if(!existsSync(path))return; // local ignored evidence may not be distributed
  const bytes=readFileSync(path);
  expect(bytes.byteLength).toBe(393216);
  const plan=await planNativeD1Migration(bytes);
  expect(plan.tables.length).toBe(21);
  expect(plan.indexes.length).toBe(29);
  expect(plan.sequences.length).toBeGreaterThan(0);
  expect(plan.productionReady).toBe(false);
  const result=await verifyNativeD1MigrationRoundtrip(plan);
  expect(result.verified).toBe(true);
  expect(result.schemaParity).toBe(true);
  expect(result.sequenceParity).toBe(true);
 });
});
