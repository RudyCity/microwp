const SECRET_SEGMENTS = new Set([
  ".git", ".svn", ".hg", ".env", ".htaccess", ".htpasswd", "node_modules",
]);
const SOURCE_EXTENSIONS = /\.(?:sql|sqlite3?|db|bak|backup|old|log|ini|inc|phar|pem|key|conf|ya?ml|toml|zip|tgz|tar|gz|7z|rar|map)$/i;
const STATIC_EXTENSIONS = /\.(?:css|js|mjs|json|jpg|jpeg|png|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|txt|pdf|mp3|mp4|webm)$/i;
const DANGEROUS_FILES = new Set(["wp-config.php","wp-config-sample.php","wp-load.php","wp-settings.php","debug.log","readme.html","license.txt"]);

export function safePathname(url: URL): string | null {
  let value = url.pathname;
  try {
    for (let i = 0; i < 2; i++) {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    }
  } catch { return null; }
  if (!value.startsWith("/") || value.includes("\\") || value.includes("\0") || value.includes("//")) return null;
  const pieces = value.split("/");
  if (pieces.some(p => p === "." || p === ".." || SECRET_SEGMENTS.has(p.toLowerCase()))) return null;
  return value;
}
export function blockedPath(path: string): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split("/").filter(Boolean);
  if (parts.some(p => p.startsWith(".") || SECRET_SEGMENTS.has(p))) return true;
  if (parts.some(p => DANGEROUS_FILES.has(p))) return true;
  if (SOURCE_EXTENSIONS.test(lower)) return true;
  if (lower.startsWith("/wp-content/uploads/") && /\.(?:php\d?|phtml|phar|svg|html?|js|mjs|xml)$/i.test(lower)) return true;
  return false;
}
export function isAssetPath(path: string): boolean {
  return STATIC_EXTENSIONS.test(path) && (
    path.startsWith("/wp-content/themes/") ||
    path.startsWith("/wp-content/plugins/") ||
    path.startsWith("/wp-content/mu-plugins/") ||
    path.startsWith("/wp-admin/") ||
    path.startsWith("/wp-includes/") ||
    path === "/favicon.ico" || path === "/robots.txt"
  );
}
export function withSafetyHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "SAMEORIGIN");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
