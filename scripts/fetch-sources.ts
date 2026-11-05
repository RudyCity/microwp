import {createHash} from "node:crypto";
import {mkdir,readFile} from "node:fs/promises";
import {join} from "node:path";
const sources=[
  {name:"wordpress-7.1.4.zip",url:"https://wordpress.org/wordpress-7.1.4.zip",sha:"a147146c159362778ecbbbfb07bb20ddf4e85b130f971c824e656a8f938c5f87"},
  {name:"sqlite-database-integration-3.1.3.zip",url:"https://downloads.wordpress.org/plugin/sqlite-database-integration.3.1.3.zip",sha:"f6ce35e8419d0b9326221a907627d905e25c2a5ba2afc86492811f14c851efe0"}
];
await mkdir("vendor/wordpress",{recursive:true});
for(const source of sources){
 const path=join("vendor/wordpress",source.name);
 try{
   const existing=await readFile(path);
   const found=createHash("sha256").update(existing).digest("hex");
   if(found===source.sha){console.log("Verified cached source:",source.name);continue}
   throw new Error("Existing file checksum mismatch; refusing overwrite: "+path);
 }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 const response=await fetch(source.url);
 if(!response.ok)throw new Error("Download "+source.name+" failed: "+response.status);
 await Bun.write(path,response);
 const checksum=createHash("sha256").update(await readFile(path)).digest("hex");
 if(checksum!==source.sha)throw new Error("Pinned source checksum mismatch: "+source.name);
 console.log("Downloaded and verified:",source.name);
}
