/**
 * Offline, bounded ZIP-loader proxy profile for microWP WordPress bootstrap.
 * Does NOT execute PHP, run WordPress, contact Cloudflare, access credentials,
 * modify application state, or create output files. Results are NOT Worker CPU.
 *
 * Usage: bun scripts/profile-wordpress-bootstrap.ts
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { indexZip, inflateEntry } from "../src/php/zip-files";

const root = join(import.meta.dir, "..");
const archivePath = join(root, "generated", "wordpress-php.bin");
const manifestPath = join(root, "generated", "wordpress-manifest.json");
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_INFLATE_BYTES_PER_ENTRY = 512 * 1024;
const MAX_TOTAL_INFLATE_BYTES = 3 * 1024 * 1024;
const SAMPLES = [
  "wp-admin/install.php",
  "wp-load.php",
  "wp-settings.php",
  "wp-includes/version.php",
  "wp-includes/load.php",
  "wp-includes/functions.php",
  "wp-includes/plugin.php",
  "wp-includes/formatting.php",
  "wp-includes/class-wpdb.php",
  "wp-includes/default-filters.php",
  "wp-admin/includes/upgrade.php",
  "wp-content/db.php",
] as const;

function measure<T>(fn: () => T) {
  const cpuStart = process.cpuUsage();
  const tStart = process.hrtime.bigint();
  const value = fn();
  const cpu = process.cpuUsage(cpuStart);
  const wallNs = process.hrtime.bigint() - tStart;
  return {
    value,
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    wallMs: Number((Number(wallNs) / 1_000_000).toFixed(3)),
  };
}

const raw = readFileSync(archivePath);
if (raw.byteLength > MAX_ARCHIVE_BYTES) {
  throw new Error("Refusing oversized archive");
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  php_archive_sha256?: string;
};
const actualHash = createHash("sha256").update(raw).digest("hex");
if (!manifest.php_archive_sha256 || actualHash !== manifest.php_archive_sha256) {
  throw new Error("Archive SHA256 does not match manifest; abort");
}
const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
const rssBefore = process.memoryUsage().rss;
const indexed = measure(() => indexZip(bytes));
const byName = new Map(indexed.value.map(entry => [entry.name, entry]));
let plannedBytes = 0;
const chosen = SAMPLES.map(name => byName.get(name)).filter(
  (entry): entry is NonNullable<typeof entry> => entry !== undefined
);
for (const entry of chosen) {
  if (entry.size > MAX_INFLATE_BYTES_PER_ENTRY) throw new Error("Entry exceeds bounded sample limit");
  plannedBytes += entry.size;
}
if (plannedBytes > MAX_TOTAL_INFLATE_BYTES) throw new Error("Cumulative inflate limit exceeded");
const inflated = measure(() => {
  let checksum = 0;
  let actualBytes = 0;
  for (const entry of chosen) {
    const data = inflateEntry(bytes, entry);
    actualBytes += data.byteLength;
    checksum = (checksum + data[0]! + data[data.length - 1]!) & 0xffff;
  }
  return { actualBytes, checksum };
});
const rssAfter = process.memoryUsage().rss;
console.log(JSON.stringify({
  kind: "offline-loader-proxy-not-wordpress-cpu",
  runtime: "bun",
  archiveSha256MatchesManifest: true,
  archiveBytes: bytes.byteLength,
  indexedEntries: indexed.value.length,
  indexedPhpFiles: indexed.value.filter(e => e.name.endsWith(".php")).length,
  declaredUncompressedBytes: indexed.value.reduce((sum, entry) => sum + entry.size, 0),
  index: { cpuMs: indexed.cpuMs, wallMs: indexed.wallMs },
  inflate: {
    entries: chosen.length, plannedBytes,
    actualBytes: inflated.value.actualBytes,
    cpuMs: inflated.cpuMs,
    wallMs: inflated.wallMs,
    checksum16: inflated.value.checksum
  },
  missingSamplePaths: SAMPLES.filter(name => !byName.has(name)),
  processRssBeforeBytes: rssBefore,
  processRssAfterBytes: rssAfter,
  processRssDeltaBytes: rssAfter - rssBefore,
  caution: "Local process CPU/RSS are not Cloudflare invocation CPU or isolate peak memory; PHP and WordPress were not executed."
}, null, 2));
