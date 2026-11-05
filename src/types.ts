/** Minimum Worker binding surfaces to keep core testable without Cloudflare credentials. */
export interface CacheKV {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, opts: { expirationTtl: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}
export interface MediaObject {
  body: ReadableStream | null;
  etag: string;
  size: number;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}
export interface MediaR2 {
  get(key: string): Promise<MediaObject | null>;
  put(
    key: string,
    body: ReadableStream | ArrayBuffer | Uint8Array,
    options: { httpMetadata: { contentType: string; cacheControl: string } }
  ): Promise<unknown>;
  list?(options: {prefix: string;limit: number}): Promise<{objects: Array<{key: string;size: number}>;truncated: boolean}>;
  delete?(key:string):Promise<void>;
}
export interface ServiceBinding { fetch(request: Request): Promise<Response> }
export interface Env {
  ASSETS?: ServiceBinding;
  MEDIA?: MediaR2;
  /** Cloudflare D1: authoritative SQLite snapshot store in D1 bridge mode. */
  DB?: D1Database;
  MICROWP_STORAGE_DRIVER?: "d1" | "durable-object";
  PAGE_CACHE?: CacheKV;
  PHP_BACKEND?: ServiceBinding;
  CACHE_TTL?: string;
  CACHE_VERSION?: string;
  /** Future persistent URL and credentials. Not enabled until a durable DB exists. */
  WP_PUBLIC_URL?: string;
  WP_SECRET_KEY?: string;
  /** Set only on deliberately isolated, non-production Cloudflare staging. */
  MICROWP_STAGING_MODE?: string;
  STAGING_PROBE_KEY?: string;
  /** Internal single-site Durable Object flag; not configured by public Wrangler users. */
  MICROWP_DEFER_MEDIA_DELETES?: string;
}
export interface ExecutionCtx { waitUntil(promise: Promise<unknown>): void }
export type PhpHandler = (request: Request, env: Env) => Promise<Response>;
