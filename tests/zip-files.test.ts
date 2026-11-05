import {describe,expect,test} from "bun:test";
import {zipSync,strToU8} from "fflate";
import {indexZip,inflateEntry} from "../src/php/zip-files";
describe("lazy WordPress ZIP filesystem",()=>{
 test("reads PHP entries without eagerly decompressing the archive",()=>{
   const bytes=zipSync({"index.php":strToU8("<?php echo 'ok';"),"wp-admin/admin.php":strToU8("<?php exit;")});
   const entries=indexZip(bytes);
   expect(entries.length).toBe(2);
   expect(new TextDecoder().decode(inflateEntry(bytes,entries[0]))).toBe("<?php echo 'ok';");
   expect(new TextDecoder().decode(inflateEntry(bytes,entries[1]))).toBe("<?php exit;");
 });
 test("rejects unsafe names",()=>{
   const bad=zipSync({"../evil.php":strToU8("<?php evil();")});
   expect(()=>indexZip(bad)).toThrow("unsafe");
 });
 test("rejects unsupported files in executable archive",()=>{
   const bad=zipSync({"secret.js":strToU8("secret")});
   expect(()=>indexZip(bad)).toThrow("unsafe");
 });
 test("rejects corrupted archives",()=>{
   expect(()=>indexZip(new Uint8Array([1,2,3]))).toThrow();
 });
});
