import type {Env} from "./types";

/**
 * An opt-in, single-purpose staging probe. No WordPress routes are opened:
 * the returned capability is limited to fixed PHP runtime checks.
 * This route has no effect without an explicit staging flag and 64+ char secret.
 */
export const PROBE_PATH="/__microwp/private/php-probe";
const encoder=new TextEncoder();
export async function isAuthorizedProbe(request:Request,env:Env):Promise<boolean>{
 if(env.MICROWP_STAGING_MODE!=="isolated-probe-only")return false;
 const secret=env.STAGING_PROBE_KEY;
 if(!secret||secret.length<64||secret.length>128)return false;
 const url=new URL(request.url);
 if(request.method!=="POST"||url.pathname!==PROBE_PATH||url.search||url.protocol!=="https:")return false;
 const supplied=request.headers.get("x-microwp-probe-key")??"";
 if(supplied.length!==secret.length||supplied.length>128)return false;
 const [expected,actual]=await Promise.all([
  crypto.subtle.digest("SHA-256",encoder.encode(secret)),
  crypto.subtle.digest("SHA-256",encoder.encode(supplied))
 ]);
 const left=new Uint8Array(expected),right=new Uint8Array(actual);
 let difference=0;
 for(let index=0;index<left.length;index++)difference|=left[index]^right[index];
 return difference===0;
}
