/**
 * Reproducible Worker compatibility transform for WordPress Playground's Emscripten loader.
 * Generated code is GPL-2.0-or-later (upstream @php-wasm/web-8-4). Do not edit node_modules.
 * The WASM binary is imported as a compiled Worker module, so its browser import.meta URL
 * cannot work as-is; override instantiateWasm in the adapter instead.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const project = join(import.meta.dir, "..");
const source = join(project, "node_modules/@php-wasm/web-8-4/asyncify/php_8_4.js");
const out = join(project, "experiments/generated/php-loader.js");
const before = readFileSync(source, "utf8");
const search = "new URL('./8_4_27/php_8_4.wasm', import.meta.url)";
const count = before.split(search).length - 1;
if (count !== 1) throw new Error(`Unexpected PHP-WASM loader format (expected 1 URL, found ${count}); aborting`);
const generated = before.replace(search, "new URL('https://php-wasm.invalid/embedded-worker-module')");
mkdirSync(join(project, "experiments/generated"), {recursive:true});
writeFileSync(out, "/* Generated from GPL-2.0-or-later @php-wasm/web-8-4; do not commit. */\n"+generated);
console.log("Generated Worker-compatible PHP loader:", out);
