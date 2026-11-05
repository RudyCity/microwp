import {handleRequest} from "./engine";
import {nativePhpHandler,nativeStats} from "./php/native";
import type {Env,ExecutionCtx} from "./types";
export default {
  fetch(request:Request,env:Env,ctx:ExecutionCtx):Promise<Response> {
    // No R2, KV, or Cloudflare production site provisioning is implied.
    const url=new URL(request.url);
    // Development diagnostics are safe: no file paths or secrets shown.
    if(url.pathname==="/__microwp/native-health")return Promise.resolve(Response.json(nativeStats(),{headers:{"Cache-Control":"no-store"}}));
    return handleRequest(request,env,ctx,nativePhpHandler,"native-wasm");
  }
};
