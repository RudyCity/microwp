import {describe,expect,test} from "bun:test";
import {wordpressConfig,mayServePreview} from "../src/php/config";
describe("native Wordpress safety",()=>{
 test("php config is not publicly accessible and uses protected DB",()=>{
    const php=wordpressConfig("http://127.0.0.1:8799",{});
    expect(php).toContain("'/private/microwp.sqlite'");
    expect(php).toContain("define('DISALLOW_FILE_EDIT',true)");
    expect(php).not.toContain("example.invalid");
  });
 test("stable per-site secret creates deterministic cookie signing salts",()=>{
    const env={WP_SECRET_KEY:"x".repeat(64)};
    const one=wordpressConfig("http://127.0.0.1:8796",env);
    const two=wordpressConfig("http://127.0.0.1:8796",env);
    expect(one).toBe(two);
    expect(one).toContain("AUTH_KEY");
    expect(one).toContain("NONCE_SALT");
 });
 test("preview refuses publicly reachable host",()=>{
    expect(mayServePreview(new URL("http://127.0.0.1:8799"),{})).toBe(true);
    expect(mayServePreview(new URL("https://microwp.workers.dev"),{})).toBe(false);
    expect(mayServePreview(new URL("https://evil.example"),{WP_PUBLIC_URL:"https://evil.example"})).toBe(false);
  });
});
