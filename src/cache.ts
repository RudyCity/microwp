import type { CacheKV, Env } from "./types";

export const MAX_CACHE_BYTES = 512 * 1024;
export interface CacheItem { body: string; contentType: string; storedAt: number; }
export function cacheEligible(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.has("cookie") || request.headers.has("authorization")) return false;
  const url = new URL(request.url);
  if (url.search !== "") return false; // do not cache search, previews, tracked or authenticated query params
  const p = url.pathname.toLowerCase();
  if (p.startsWith("/wp-admin") || p.startsWith("/wp-json") ||
      p.startsWith("/wp-login") || p.startsWith("/xmlrpc") ||
      p.startsWith("/wp-cron") || p.startsWith("/?") ||
      p.startsWith("/cart") || p.startsWith("/checkout") ||
      p.startsWith("/my-account") || p.startsWith("/account")) return false;
  return true;
}
export function cacheKey(request: Request, version = "v1"): string {
  const url = new URL(request.url);
  // Candidate requests cannot contain a query; version supports global invalidation at deploy.
  return `microwp:${version}:${url.origin}${url.pathname}`;
}
export function cacheTTL(env: Env): number {
  const ttl = Number(env.CACHE_TTL ?? "120");
  return Number.isInteger(ttl) && ttl >= 60 && ttl <= 86400 ? ttl : 120;
}
export async function cachedResponse(kv: CacheKV | undefined, key: string): Promise<Response | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(key, "text");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheItem;
    if (typeof parsed.body !== "string" || typeof parsed.contentType !== "string") return null;
    return new Response(parsed.body, { headers: { "Content-Type": parsed.contentType, "X-microWP-cache": "HIT" } });
  } catch { return null; } // broken or unavailable KV must not break WordPress traffic
}
export async function maybeCache(kv: CacheKV | undefined, key: string, response: Response, ttl: number): Promise<void> {
  if (!kv || response.status !== 200 || response.headers.has("set-cookie")) return;
  const type = response.headers.get("content-type") ?? "";
  if (!/\btext\/html\b/i.test(type)) return;
  const cacheControl = response.headers.get("cache-control") ?? "";
  const vary = response.headers.get("vary") ?? "";
  if (/private|no-store|no-cache/i.test(cacheControl) || /cookie|authorization|\*/i.test(vary)) return;
  const contentLength = Number(response.headers.get("content-length"));
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_CACHE_BYTES) return;
  // Read only a bounded, declared-size response. No body without Content-Length is cached.
  const body = await response.clone().text();
  if (new TextEncoder().encode(body).byteLength > MAX_CACHE_BYTES) return;
  try {
    await kv.put(key, JSON.stringify({body,contentType:type,storedAt:Date.now()} satisfies CacheItem), {expirationTtl:ttl});
  } catch { /* fail-open: cache is optional */ }
}
