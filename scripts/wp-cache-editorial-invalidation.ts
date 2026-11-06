/** Isolated read/seed proof only: fixed-value probe, no user-supplied cache contents. */
const base=process.env.MICROWP_E2E_URL??"http://127.0.0.1:19152";
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error("Loopback test only");
const mode=process.argv[2];
if(mode!=="seed"&&mode!=="hit"&&mode!=="miss")throw Error("Expected seed|hit|miss");
const response=await fetch(base+"/__local/public-cache-"+(mode==="seed"?"seed":"check"),{
 method:"POST",signal:AbortSignal.timeout(10000)
});
const data=await response.json() as {ok?:boolean;stored?:boolean;found?:boolean;valid?:boolean};
const pass=response.status===200&&data.ok===true&&
 (mode==="seed"?data.stored===true:mode==="hit"?data.found===true&&data.valid===true:data.found===false);
if(!pass)throw Error("Public content cache "+mode+" failed with status "+response.status);
console.log("PASS local WordPress public cache",mode,"at correct transaction boundary");
