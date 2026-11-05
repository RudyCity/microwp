import {describe,expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {saveD1SQLite,type D1SqlStore} from "../src/storage/d1-sqlite";
import {planR2OrphanAudit,MAX_AUDIT_OBJECTS,type OrphanAuditDeps} from "../src/storage/r2-orphan-audit";

const A="wp-content/uploads/2026/11/a.png";
const B="wp-content/uploads/2026/11/b.png";
const C="wp-content/uploads/2026/11/c.webp";
const REV_BYTES=new Uint8Array([83,81,76,105,1,2,3,4]);
function fixture(){
  const sql=new Database(":memory:");
  for(const name of ["0001_microwp_sqlite_snapshots.sql","0002_microwp_media_delete_journal.sql"])
    sql.exec(readFileSync("migrations/"+name,"utf8"));
  const db={
    prepare(query:string){return {bind(...args:unknown[]){return {
      sql:query,args,
      async first(){return sql.prepare(query).get(...args as [string])??null},
      async all(){return {success:true,results:sql.prepare(query).all(...args as [string])}},
      async run(){return sql.prepare(query).run(...args as [string])}
    }}}},
    async batch(commands:{sql:string;args:unknown[]}[]){
      sql.transaction(()=>{for(const c of commands)sql.prepare(c.sql).run(...c.args as [string])})();
      return [];
    }
  } as unknown as D1SqlStore;
  let objects:unknown={objects:[{key:A,size:10},{key:B,size:20},{key:C,size:30}],truncated:false};
  const requested:{prefix:string;limit:number}[]=[];
  const r2={async list(options:{prefix:string;limit:number}){requested.push(options);return objects}};
  let calls=0;
  const deps:OrphanAuditDeps={db,r2,extractReferences:async bytes=>{
    calls++;expect(bytes).toEqual(REV_BYTES);return {complete:true as const,keys:[A]};
  }};
  return {sql,db,deps,requested,setListing:(v:unknown)=>objects=v,calls:()=>calls};
}
async function ready(){const f=fixture();await saveD1SQLite(f.db,REV_BYTES);return f;}

describe("bounded R2 orphan audit (non-destructive)",()=>{
  test("reconciles verified D1 evidence and R2 listing as dry-run candidates",async()=>{
    const f=await ready();
    const report=await planR2OrphanAudit(f.deps);
    expect(report.version).toBe(1);
    expect(report.mode).toBe("dry-run");
    expect(report.deletionAuthorized).toBe(false);
    expect(report.referenced).toEqual([A]);
    expect(report.candidates.map(x=>x.key)).toEqual([B,C]);
    expect(report.totalBytes).toBe(60);
    expect(f.requested).toEqual([{prefix:"wp-content/uploads/",limit:MAX_AUDIT_OBJECTS+1}]);
    expect(f.calls()).toBe(1);
  });
  test("pending D1 deletion journal is protected rather than a purge instruction",async()=>{
    const f=await ready();
    f.sql.prepare("INSERT INTO microwp_media_delete_journal(site_id,object_key) VALUES(?,?)")
      .run("microwp:single-site:v1",B);
    const report=await planR2OrphanAudit(f.deps);
    expect(report.journalPending).toEqual([B]);
    expect(report.candidates.map(x=>x.key)).toEqual([C]);
  });
  test("missing D1 snapshot fails closed without listing R2",async()=>{
    const f=fixture();
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Missing D1 SQLite snapshot");
    expect(f.requested).toEqual([]);
  });
  test("corrupt D1 snapshot refuses audit",async()=>{
    const f=await ready();
    f.sql.prepare("UPDATE microwp_db_snapshots SET sha256=?").run("0".repeat(64));
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("SHA256 mismatch");
    expect(f.requested).toEqual([]);
  });
  test("incomplete reference extraction fails closed",async()=>{
    const f=await ready();
    f.deps.extractReferences=async()=>({complete:false,keys:[]} as never);
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Incomplete");
    expect(f.requested).toEqual([]);
  });
  test("truncated listing fails closed",async()=>{
    const f=await ready();f.setListing({objects:[{key:A,size:10}],truncated:true});
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Truncated");
  });
  test("oversized listing fails closed",async()=>{
    const f=await ready();
    f.setListing({objects:Array.from({length:33},(_,i)=>({key:"wp-content/uploads/"+i+".png",size:10})),truncated:false});
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("oversized");
  });
  test("corrupt listing shapes fail closed",async()=>{
    const f=await ready();
    for(const shape of [null,{}, {objects:"invalid",truncated:false},{objects:[null],truncated:false},
      {objects:[{key:A,size:NaN}],truncated:false}]){
      f.setListing(shape);
      await expect(planR2OrphanAudit(f.deps)).rejects.toThrow();
    }
  });
  test("rejects unsafe, duplicate and out-of-prefix keys",async()=>{
    const f=await ready();
    for(const key of ["outside/a.png","wp-content/uploads/../bad.png","wp-content/uploads/x.php",
      "wp-content/uploads/.secret.png","wp-content/uploads/a%2fb.png"]){
      f.setListing({objects:[{key,size:1}],truncated:false});
      await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Unsafe");
    }
    f.setListing({objects:[{key:A,size:1},{key:A,size:1}],truncated:false});
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("duplicate");
  });
  test("rejects per-object and aggregate oversized entries",async()=>{
    const f=await ready();
    f.setListing({objects:[{key:A,size:10*1024*1024+1}],truncated:false});
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("oversized");
    f.setListing({objects:[{key:A,size:10*1024*1024},{key:B,size:7*1024*1024}],truncated:false});
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("total byte");
  });
  test("rejects invalid evidence keys and corrupted journal",async()=>{
    const f=await ready();
    f.deps.extractReferences=async()=>({complete:true,keys:["wp-content/uploads/../a.png"]});
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Unsafe");
    f.deps.extractReferences=async()=>({complete:true,keys:[A]});
    f.sql.prepare("INSERT INTO microwp_media_delete_journal(site_id,object_key) VALUES(?,?)")
      .run("microwp:single-site:v1","outside/evil.png");
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Unsafe");
  });
  test("detects D1 revision change during R2 listing",async()=>{
    const f=await ready();
    f.deps.r2.list=async()=>{
      f.sql.prepare("UPDATE microwp_db_snapshots SET revision=?").run("a".repeat(8)+"-"+"a".repeat(4)+"-"+"a".repeat(4)+"-"+"a".repeat(4)+"-"+"a".repeat(12));
      return {objects:[],truncated:false};
    };
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("revision changed");
  });
  test("invalid site ID rejected before querying",async()=>{
    const f=await ready();
    f.deps.siteId="../other";
    await expect(planR2OrphanAudit(f.deps)).rejects.toThrow("Unsafe D1 site ID");
  });
});
