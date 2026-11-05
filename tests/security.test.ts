import { describe, expect, test } from "bun:test";
import { blockedPath, isAssetPath, safePathname } from "../src/security";

describe("path safety", () => {
  for (const route of [
    "/wp-config.php", "/wp-content/uploads/hack.php", "/wp-content/uploads/evil.svg",
    "/wp-content/uploads/evil.html", "/.env", "/.git/config",
    "/wp-content/debug.log", "/backup.sql", "/wp-content/uploads/a%252f..%252fwp-config.php",
    "/wp-content/uploads/%255cwindows%255csecret.jpg"
  ]) test(`rejects ${route}`, () => {
    const path = safePathname(new URL("https://site.example" + route));
    expect(path === null || blockedPath(path)).toBe(true);
  });
  test("allows valid WordPress routes", () => {
    for (const path of ["/","/wp-admin/","/wp-login.php","/index.php",
      "/wp-json/wp/v2/posts","/wp-content/themes/foo/style.css","/2026/11/halo-dunia/"]) {
      const normalized = safePathname(new URL("https://site.example" + path));
      expect(normalized).not.toBeNull();
      expect(blockedPath(normalized!)).toBe(false);
    }
  });
  test("only treats safe asset paths as static", () => {
    expect(isAssetPath("/wp-content/themes/theme/style.css")).toBe(true);
    expect(isAssetPath("/wp-content/plugins/test/admin.php")).toBe(false);
    expect(isAssetPath("/wp-content/uploads/test.jpg")).toBe(false);
    expect(isAssetPath("/wp-includes/js/jquery/jquery.min.js")).toBe(true);
  });
});
