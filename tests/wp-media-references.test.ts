import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {extractWordPressMediaReferences,extractReferencesForOrphanAudit} from "../src/storage/wp-media-references";

function fixture(change?:(db:Database)=>void):Uint8Array{
  const db=new Database(":memory:");
  db.exec("CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY, post_content TEXT, guid TEXT);"+
    "CREATE TABLE wp_postmeta (meta_id INTEGER PRIMARY KEY, meta_value TEXT);"+
    "CREATE TABLE wp_options (option_name TEXT, option_value TEXT)");
  change?.(db);
  const bytes=db.serialize();
  db.close();
  return bytes;
}
describe("offline WordPress media evidence (fail closed)",()=>{
  test("discovers attachment GUID, content images and thumbnail metadata but never certifies completeness",async()=>{
    const bytes=fixture(db=>{
      db.prepare("INSERT INTO wp_posts VALUES (1,?,?)").run(
        '<img src="/wp-content/uploads/2026/11/post.png">',
        "https://example.test/wp-content/uploads/2026/11/original.jpg");
      db.prepare("INSERT INTO wp_postmeta VALUES (1,?)").run(
        'a:1:{s:4:"file";s:46:"/wp-content/uploads/2026/11/original-150x150.jpg";}');
    });
    const result=await extractWordPressMediaReferences(bytes);
    expect(result.keys).toEqual([
      "wp-content/uploads/2026/11/original-150x150.jpg",
      "wp-content/uploads/2026/11/original.jpg",
      "wp-content/uploads/2026/11/post.png"
    ]);
    expect(result.complete).toBe(false);
    expect(result.deletionAuthorized).toBe(false);
    expect(result.scannedTables).toContain("wp_posts");
    expect(result.reasons.length).toBeGreaterThan(0);
    await expect(extractReferencesForOrphanAudit(bytes)).rejects.toThrow("Incomplete D1 reference evidence");
  });
  test("unknown plugin tables are scanned but invalidate any completeness assumption",async()=>{
    const result=await extractWordPressMediaReferences(fixture(db=>{
      db.exec("CREATE TABLE wp_plugin_gallery (url TEXT)");
      db.prepare("INSERT INTO wp_plugin_gallery VALUES (?)").run("/wp-content/uploads/gallery/a.webp");
    }));
    expect(result.keys).toEqual(["wp-content/uploads/gallery/a.webp"]);
    expect(result.reasons.join(" ")).toContain("Unknown table or plugin data");
    expect(result.complete).toBe(false);
  });
  test("missing or corrupt snapshot is incomplete without throwing or authorizing delete",async()=>{
    for(const bytes of [new Uint8Array(),new Uint8Array(150)]){
      const result=await extractWordPressMediaReferences(bytes);
      expect(result.complete).toBe(false);
      expect(result.keys).toEqual([]);
      expect(result.deletionAuthorized).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
  test("row scan limit fails closed even when some references were discovered",async()=>{
    const result=await extractWordPressMediaReferences(fixture(db=>{
      const insert=db.prepare("INSERT INTO wp_posts(ID,post_content) VALUES (?,?)");
      db.transaction(()=>{for(let i=1;i<=4097;i++)insert.run(i,"/wp-content/uploads/2026/11/a.png")})();
    }));
    expect(result.complete).toBe(false);
    expect(result.reasons.join(" ")).toContain("row scan limit");
  });
  test("relative attachment metadata is never misrepresented as complete",async()=>{
    const result=await extractWordPressMediaReferences(fixture(db=>{
      db.prepare("INSERT INTO wp_postmeta VALUES(1,?)").run('a:1:{s:4:"file";s:16:"2026/11/file.png";}');
    }));
    expect(result.complete).toBe(false);
    expect(result.reasons.join(" ")).toContain("Relative attachment paths");
  });
  test("rejects oversized input without SQLite deserialization",async()=>{
    const result=await extractWordPressMediaReferences(new Uint8Array(8*1024*1024+1));
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("Invalid or oversized SQLite snapshot");
  });
});
