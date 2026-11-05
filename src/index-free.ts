/**
 * Opt-in Free-tier public preview: static pages, native D1 published index,
 * and read-only R2 media. Does not invoke PHP-WASM or WordPress.
 * The deployed Durable Object staging entrypoint remains unchanged.
 */
import {handleFreePublicRequest,type FreePreviewEnv} from "./free-site/public-edge";

export default {
  fetch(request:Request,env:FreePreviewEnv):Promise<Response>{
    return handleFreePublicRequest(request,env);
  }
};
