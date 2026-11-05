import type { Env, ExecutionCtx, PhpHandler } from "./types";
import { blockedPath, isAssetPath, safePathname, withSafetyHeaders } from "./security";
import { cacheEligible, cacheKey, cacheTTL, cachedResponse, maybeCache } from "./cache";
import { getMedia } from "./media";
import { servicePhpHandler } from "./runtime";

export async function handleRequest(
  request: Request, env: Env, ctx: ExecutionCtx,
  php: PhpHandler = servicePhpHandler, runtimeMode?: string
): Promise<Response> {
  let url: URL;
  try { url = new URL(request.url); } catch { return new Response("Bad Request",{status:400}); }
  const path = safePathname(url);
  if (path === null || blockedPath(path)) return withSafetyHeaders(new Response("Not Found",{status:404}));
  if (path === "/__microwp/health") {
    return withSafetyHeaders(Response.json({
      name: "microWP", version: "0.2.0", edge: "ready",
      php: runtimeMode ?? (env.PHP_BACKEND ? "service-binding" : "not-configured"),
      media: env.MEDIA ? "configured" : "not-configured",
      cache: env.PAGE_CACHE ? "configured" : "not-configured"
    }, {headers:{"Cache-Control":"no-store"}}));
  }
  if (path.startsWith("/__microwp/")) return withSafetyHeaders(new Response("Not Found",{status:404}));
  if (path.startsWith("/wp-content/uploads/"))
    return withSafetyHeaders(await getMedia(request,env,path));
  if ((request.method === "GET" || request.method === "HEAD") && isAssetPath(path) && env.ASSETS) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return withSafetyHeaders(asset);
  }
  // Never serve or write page cache for native WordPress until publish/edit invalidation is proven.
  const eligible = !runtimeMode?.startsWith("native-") && cacheEligible(request);
  const key = eligible ? cacheKey(request, env.CACHE_VERSION ?? "v1") : "";
  if (eligible) {
    const cached = await cachedResponse(env.PAGE_CACHE,key);
    if (cached) return withSafetyHeaders(cached);
  }
  const origin = await php(request,env);
  const headers = new Headers(origin.headers);
  headers.set("X-microWP-cache", eligible && env.PAGE_CACHE ? "MISS" : "BYPASS");
  const response = new Response(origin.body,{status:origin.status,statusText:origin.statusText,headers});
  if (eligible && env.PAGE_CACHE) ctx.waitUntil(maybeCache(env.PAGE_CACHE,key,response,cacheTTL(env)));
  return withSafetyHeaders(response);
}
