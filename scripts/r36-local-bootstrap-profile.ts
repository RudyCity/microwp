/**
 * Three repeatable, self-owned local Workerd WordPress bootstrap samples.
 * Does not contact Cloudflare, install secrets, or change public configuration.
 */
import {mkdir,writeFile} from "node:fs/promises";
import {runWorkerd} from "./profile-wordpress-php-bootstrap";
import {summarizeR36LocalBootstrap} from "../src/probes/r36-bootstrap-wall-summary";
if(process.argv.length>2)throw Error("R36 local bootstrap profiler accepts no options");
const samples=[];
for(let i=0;i<3;i++){
 const value=await runWorkerd();
 samples.push(value);
 console.log("PASS R36 local WordPress installer "+(i+1)+"/3"+
  " coldWallMs="+value.initAndFirstInstaller.wallMs+
  " warmWallMs="+value.repeatedInstaller.wallMs+
  " cpuMs=null memoryBytes=null");
}
const summary=summarizeR36LocalBootstrap(samples);
await mkdir(".wrangler",{recursive:true});
await writeFile(".wrangler/r36-wordpress-bootstrap-local.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
