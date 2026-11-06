import {Database} from "bun:sqlite";
import {describe,expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {
  USER_LOGIN_MAX_BYTES,USER_PASS_MAX_BYTES,USERMETA_BATCH_MAX_IDS,
  USERMETA_MAX_ROWS,USERMETA_VALUE_MAX_BYTES,
  readPrivateUserAuthByLogin,readPrivateUserMetaByUserIds,
  type TrustedUserReadConfig
} from "../src/php/d1-wpdb-conformance/user-reads";

const authCap=Object.freeze({auth:true});
const metaCap=Object.freeze({meta:true});
const config:TrustedUserReadConfig={
  scope:{column:"site_id",value:"site_a"},
  authCapability:authCap,userMetaCapability:metaCap
};
type Call={sql:string;args:(string|number|null)[]};
function fixture(unique=true){
  const sqlite=new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE wp_users ("+
    "site_id TEXT NOT NULL,ID INTEGER NOT NULL,user_login TEXT NOT NULL,"+
    "user_pass TEXT NOT NULL,user_status INTEGER NOT NULL"+
    (unique?",UNIQUE(site_id,user_login)":"")+
    ");"+
    "CREATE TABLE wp_usermeta ("+
    "site_id TEXT NOT NULL,umeta_id INTEGER NOT NULL,user_id INTEGER NOT NULL,"+
    "meta_key TEXT,meta_value TEXT,UNIQUE(site_id,umeta_id));"
  );
  const user=sqlite.prepare("INSERT INTO wp_users VALUES (?,?,?,?,?)");
  const meta=sqlite.prepare("INSERT INTO wp_usermeta VALUES (?,?,?,?,?)");
  user.run("site_a",1,"admin","$P$hash_a",0);
  user.run("site_b",2,"admin","$P$PRIVATE_B",0);
  meta.run("site_a",10,1,"nickname","Admin A");
  meta.run("site_a",11,1,"empty","");
  meta.run("site_a",12,1,null,null);
  meta.run("site_b",10,2,"secret","PRIVATE");
  const calls:Call[]=[];
  const db={prepare(sql:string){return {bind(...args:(string|number|null)[]){
    calls.push({sql,args});
    return {all:async()=>({success:true,results:sqlite.prepare(sql).all(...args)})};
  }}}} as unknown as D1Database;
  return {sqlite,user,meta,calls,db};
}
describe("private WordPress user auth/usermeta native D1 reads",()=>{
  test("login auth returns only minimal site-scoped row in one prepared query",async()=>{
    const f=fixture();
    const row=await readPrivateUserAuthByLogin("admin",config,f.db,authCap);
    expect(row).toEqual({ID:1,user_login:"admin",user_pass:"$P$hash_a",user_status:0});
    expect(Object.isFrozen(row)).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toContain('"site_id" = ? AND "user_login" = ? LIMIT 2');
    expect(f.calls[0]?.sql).not.toContain("$P$hash_a");
    expect(f.calls[0]?.args.slice(-2)).toEqual(["site_a","admin"]);
    expect(JSON.stringify(row)).not.toContain("PRIVATE_B");
    f.sqlite.close();
  });
  test("absent login returns null without leaking another site's matching login",async()=>{
    const f=fixture();
    expect(await readPrivateUserAuthByLogin("missing",config,f.db,authCap)).toBeNull();
    expect(f.calls).toHaveLength(1);
    f.sqlite.close();
  });
  test("usermeta batch matches IN/order shape and excludes another site",async()=>{
    const f=fixture();
    const rows=await readPrivateUserMetaByUserIds([2,1],config,f.db,metaCap);
    expect(rows).toEqual([
      {umeta_id:10,user_id:1,meta_key:"nickname",meta_value:"Admin A"},
      {umeta_id:11,user_id:1,meta_key:"empty",meta_value:""},
      {umeta_id:12,user_id:1,meta_key:null,meta_value:null}
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(f.calls[0]?.sql).toContain('"user_id" IN (?, ?)');
    expect(f.calls[0]?.sql).toContain('ORDER BY "umeta_id" ASC LIMIT ?');
    expect(f.calls[0]?.args.slice(-4)).toEqual(["site_a",2,1,USERMETA_MAX_ROWS+1]);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    f.sqlite.close();
  });
  test("32 user IDs remain one query with bounded bindings",async()=>{
    const f=fixture();
    const ids=Array.from({length:USERMETA_BATCH_MAX_IDS},(_,i)=>i+1);
    expect((await readPrivateUserMetaByUserIds(ids,config,f.db,metaCap))).toHaveLength(3);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.args.length).toBe(2+1+32+1);
    f.sqlite.close();
  });
  test("wrong capability, malformed login and malformed IDs fail before D1",async()=>{
    const f=fixture();
    const calls=[
      ()=>readPrivateUserAuthByLogin("admin",config,f.db,metaCap),
      ()=>readPrivateUserMetaByUserIds([1],config,f.db,authCap),
      ()=>readPrivateUserAuthByLogin("",config,f.db,authCap),
      ()=>readPrivateUserAuthByLogin("x\u0000y",config,f.db,authCap),
      ()=>readPrivateUserAuthByLogin("é".repeat(USER_LOGIN_MAX_BYTES),config,f.db,authCap),
      ()=>readPrivateUserMetaByUserIds([],config,f.db,metaCap),
      ()=>readPrivateUserMetaByUserIds([1,1],config,f.db,metaCap),
      ()=>readPrivateUserMetaByUserIds([0],config,f.db,metaCap),
      ()=>readPrivateUserMetaByUserIds(new Array(1) as number[],config,f.db,metaCap),
      ()=>readPrivateUserMetaByUserIds(
        Array.from({length:USERMETA_BATCH_MAX_IDS+1},(_,i)=>i+1),config,f.db,metaCap),
      ()=>readPrivateUserAuthByLogin("admin",
        {...config,scope:{column:"user_login",value:"site_a"}},f.db,authCap),
      ()=>readPrivateUserAuthByLogin("admin",
        {...config,authCapability:metaCap},f.db,authCap)
    ];
    for(const call of calls)
      await expect(call()).rejects.toThrow("Private WordPress user D1 read rejected");
    expect(f.calls).toHaveLength(0);
    f.sqlite.close();
  });
  test("duplicate auth rows, oversize hash/meta and meta overflow fail closed",async()=>{
    const f=fixture(false);
    f.user.run("site_a",3,"admin","$P$second",0);
    await expect(readPrivateUserAuthByLogin("admin",config,f.db,authCap)).rejects.toThrow();
    f.sqlite.close();

    const large=fixture();
    large.sqlite.prepare("UPDATE wp_users SET user_pass=? WHERE site_id='site_a' AND ID=1")
      .run("x".repeat(USER_PASS_MAX_BYTES+1));
    await expect(readPrivateUserAuthByLogin("admin",config,large.db,authCap)).rejects.toThrow();
    large.sqlite.prepare("UPDATE wp_users SET user_pass='$P$safe' WHERE site_id='site_a' AND ID=1").run();
    large.sqlite.prepare("UPDATE wp_usermeta SET meta_value=? WHERE site_id='site_a' AND umeta_id=10")
      .run("x".repeat(USERMETA_VALUE_MAX_BYTES+1));
    await expect(readPrivateUserMetaByUserIds([1],config,large.db,metaCap)).rejects.toThrow();
    large.sqlite.close();

    const overflow=fixture();
    for(let i=0;i<=USERMETA_MAX_ROWS;i++)
      overflow.meta.run("site_a",1000+i,1,"k"+i,"v");
    await expect(readPrivateUserMetaByUserIds([1],config,overflow.db,metaCap)).rejects.toThrow();
    overflow.sqlite.close();
  });
  test("malformed responses cannot forge auth or usermeta fields",async()=>{
    for(const results of [
      [{ID:1,user_login:"admin",user_pass:"hash"}],
      [{ID:1,user_login:"other",user_pass:"hash",user_status:0}],
      [{ID:1,user_login:"admin",user_pass:"hash",user_status:0,secret:"leak"}],
      [{ID:0,user_login:"admin",user_pass:"hash",user_status:0}]
    ]){
      const db=({prepare:()=>({bind:()=>({all:async()=>({success:true,results})})})}) as unknown as D1Database;
      await expect(readPrivateUserAuthByLogin("admin",config,db,authCap)).rejects.toThrow();
    }
    for(const results of [
      [{umeta_id:10,user_id:1,meta_key:"x",meta_value:"v",secret:"leak"}],
      [{umeta_id:10,user_id:2,meta_key:"x",meta_value:"v"}],
      [{umeta_id:11,user_id:1,meta_key:"x",meta_value:"v"},
       {umeta_id:10,user_id:1,meta_key:"x",meta_value:"v"}]
    ]){
      const db=({prepare:()=>({bind:()=>({all:async()=>({success:true,results})})})}) as unknown as D1Database;
      await expect(readPrivateUserMetaByUserIds([1],config,db,metaCap)).rejects.toThrow();
    }
  });
  test("sensitive reader is absent from live WordPress and staging paths",()=>{
    for(const path of ["src/php/native.ts","src/index-durable.ts","src/php/d1-wpdb/db.php"])
      expect(readFileSync(path,"utf8")).not.toContain("d1-wpdb-conformance/user-reads");
  });
});
