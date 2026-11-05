import type { Env, PhpHandler } from "./types";
/**
 * The bridge for PHP. An actual Cloudflare-compatible PHP-WASM module must implement
 * PhpHandler to run WordPress in-process. PHP_BACKEND is an optional transitional
 * *service binding*, not a WASM implementation. Never expose credentials in URLs.
 */
export const servicePhpHandler: PhpHandler = async (request, env) => {
  if (!env.PHP_BACKEND) {
    return Response.json({
      error: "PHP_WASM_NOT_CONFIGURED",
      message: "microWP edge gateway is running. An in-isolate PHP-WASM runtime is not integrated yet.",
      docs: "/__microwp/health"
    }, {status:503,headers:{"Cache-Control":"no-store"}});
  }
  try { return await env.PHP_BACKEND.fetch(request); }
  catch { return Response.json({error:"PHP_BACKEND_UNAVAILABLE"},{status:502,headers:{"Cache-Control":"no-store"}}); }
};
