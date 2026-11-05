import { handleRequest } from "./engine";
import type { Env, ExecutionCtx } from "./types";
export default {
  fetch(request: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    return handleRequest(request,env,ctx);
  }
};
