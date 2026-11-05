import {describe,expect,test} from "bun:test";
import {isAuthorizedProbe,PROBE_PATH} from "../src/staging-probe";
import {safePathname,blockedPath} from "../src/security";
import {r2MediaKey} from "../src/media";
import {decodeD1Request,handleD1ProtocolMessage} from "../src/php/d1-protocol";

const secret="s".repeat(64);
const env={MICROWP_STAGING_MODE:"isolated-probe-only",STAGING_PROBE_KEY:secret};
const probe=(url="https://staging.example"+PROBE_PATH,method="POST",key=secret)=>
  new Request(url,{method,headers:{"x-microwp-probe-key":key}});

describe("stage-2 independent security regressions (offline only)",()=>{
  test("probe requires explicit staging, correct key, HTTPS POST and empty query",async()=>{
    expect(await isAuthorizedProbe(probe(),env)).toBe(true);
    expect(await isAuthorizedProbe(probe(),{})).toBe(false);
    expect(await isAuthorizedProbe(probe(),{...env,STAGING_PROBE_KEY:"short"})).toBe(false);
    for(const request of [probe(undefined,"GET"),probe(undefined,"POST","bad"),probe("http://staging.example"+PROBE_PATH),probe("https://staging.example"+PROBE_PATH+"?x=1")])
      expect(await isAuthorizedProbe(request,env)).toBe(false);
  });
  test("decoded traversal and protected WordPress files are blocked",()=>{
    for(const raw of ["https://example.test/wp-content/uploads/%252e%252e/private.png","https://example.test/%252e%252e/wp-config.php","https://example.test/.git/config"]){
      const p=safePathname(new URL(raw));
      expect(p===null||blockedPath(p)).toBe(true);
    }
    expect(blockedPath("/wp-content/uploads/shell.php")).toBe(true);
  });
  test("D1 rejects SQL injection in identifiers before DB prepare",async()=>{
    let prepares=0;
    const db={prepare(){prepares++;throw Error("should never execute")}} as unknown as D1Database;
    const policy={tables:{posts:{select:["id"],scope:{column:"site_id",value:"site-A"}}}};
    const raw=JSON.stringify({version:1,id:"a",op:"select",table:"posts; DROP TABLE posts",columns:["id"]});
    expect(()=>decodeD1Request(raw)).toThrow();
    const response=JSON.parse(await handleD1ProtocolMessage(raw,db,policy));
    expect(response.error).toBe("BAD_REQUEST");
    expect(prepares).toBe(0);
  });
  test("D1 denies tenant scope override and disallowed table before prepare",async()=>{
    let prepares=0;
    const db={prepare(){prepares++;throw Error("should never execute")}} as unknown as D1Database;
    const policy={tables:{posts:{select:["id"],filter:["site_id"],scope:{column:"site_id",value:"site-A"}}}};
    for(const payload of [
      {version:1,id:"a",op:"select",table:"posts",columns:["id"],where:[{column:"site_id",value:"site-B"}]},
      {version:1,id:"b",op:"select",table:"other",columns:["id"]}
    ]){
      const result=JSON.parse(await handleD1ProtocolMessage(JSON.stringify(payload),db,policy));
      expect(result.error).toBe("NOT_ALLOWED");
    }
    expect(prepares).toBe(0);
  });
  test("R2 upload names reject ambiguous encoding and control characters",()=>{
    for(const path of [
      "/wp-content/uploads/a%2fb.png", "/wp-content/uploads/a?b.png",
      "/wp-content/uploads/a#b.png", "/wp-content/uploads/a\b.png",
      "/wp-content/uploads/a\u0000b.png", "/wp-content/uploads/a\u007fb.png",
      "/wp-content/uploads/dir./photo.png", "/wp-content/uploads/dir /photo.png",
      "/wp-content/uploads/cafe\u0301.png"
    ])expect(r2MediaKey(path)).toBeNull();
    expect(r2MediaKey("/wp-content/uploads/café.png")).toBe("wp-content/uploads/café.png");
  });
  test("uploads key creation rejects direct dot traversal and executable PHP",()=>{
    for(const path of ["/wp-content/uploads/../x.png","/wp-content/uploads/.hidden.png","/wp-content/uploads/x.php","/wp-content/uploads/a\\b.png"])
      expect(r2MediaKey(path)).toBeNull();
    expect(r2MediaKey("/wp-content/uploads/2026/11/photo.png")).toBe("wp-content/uploads/2026/11/photo.png");
  });
});
