/**
 * Stage-3 local-only WordPress PHP bootstrap CPU probe.
 *
 * Usage:
 *   bun scripts/profile-wordpress-php-bootstrap.ts --inspect
 *   bun scripts/profile-wordpress-php-bootstrap.ts --workerd
 *
 * No remote URLs, deploy, config writes, DB migrations or PHP source injection.
 * The workerd mode starts a self-owned local Wrangler child on loopback only.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indexZip, inflateEntry } from "../src/php/zip-files";

export const PHASE_FILES = [
  "wp-admin/install.php",
  "wp-load.php",
  "wp-config-sample.php",
  "wp-settings.php",
  "wp-includes/load.php",
  "wp-includes/plugin.php",
  "wp-includes/default-filters.php",
  "wp-includes/class-wpdb.php",
] as const;

export interface PhaseSample {
  wallMs: number;
  cpuMs: number | null;
  rssBeforeBytes: number | null;
  rssAfterBytes: number | null;
}
export interface WorkerdSample {
  kind: "local-workerd-wordpress-php-bootstrap";
  initAndFirstInstaller: PhaseSample;
  repeatedInstaller: PhaseSample;
  wasmReadyMsFromLog: number | null;
  zipReadyMsFromLog: number | null;
  configReadyMsFromLog: number | null;
  statusCodes: [number, number];
  installerForm: [boolean, boolean];
  phaseIsolation: "first request includes PHP init, MEMFS mount, wp-settings and installer; subsequent request includes wp-settings and installer; these are NOT isolated CPU values";
}
export function finiteLimit(value: number, max: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max;
}
export function extractBootstrapMarkers(log: string) {
  function find(marker: string): number | null {
    const matches = [...log.matchAll(new RegExp(marker + "\\s+(\\d+)", "g"))];
    const value = matches.length ? Number(matches[0]![1]) : NaN;
    return finiteLimit(value, 300_000) ? value : null;
  }
  return {
    wasmReadyMsFromLog: find("WASM_READY_MS"),
    zipReadyMsFromLog: find("ZIP_READY_MS"),
    configReadyMsFromLog: find("CONFIG_READY_MS"),
  };
}
export function validatePhaseSamples(sample: WorkerdSample): boolean {
  const p = [sample.initAndFirstInstaller, sample.repeatedInstaller];
  return p.every(x => finiteLimit(x.wallMs, 300_000) && (x.cpuMs === null || finiteLimit(x.cpuMs, 300_000))) &&
    sample.statusCodes.every(x => x >= 100 && x <= 599);
}
export function inspectBootstrap() {
  const root = join(import.meta.dir, "..");
  const archive = readFileSync(join(root, "generated", "wordpress-php.bin"));
  if (archive.byteLength > 16 * 1024 * 1024) throw new Error("Archive exceeds bound");
  const manifest = JSON.parse(readFileSync(join(root, "generated", "wordpress-manifest.json"), "utf8")) as {php_archive_sha256?: string};
  const sha = createHash("sha256").update(archive).digest("hex");
  if (!manifest.php_archive_sha256 || sha !== manifest.php_archive_sha256) throw new Error("Pinned WordPress archive SHA-256 mismatch");
  const bytes = new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength);
  const entries = indexZip(bytes);
  const byName = new Map(entries.map(x => [x.name, x]));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const observations = PHASE_FILES.map(path => {
    const entry = byName.get(path);
    if (!entry) return { path, present: false, size: 0, includes: [] as string[] };
    if (entry.size > 1024 * 1024) throw new Error("Unbounded PHP source file");
    const source = decoder.decode(inflateEntry(bytes, entry));
    // Static hints only; dynamic require paths are not resolved and do not produce CPU time.
    const includes = Array.from(source.matchAll(/\b(?:require|include)(?:_once)?\s*(?:\(?\s*)?(?:ABSPATH\s*\.\s*)?['"]([^'"]{1,160})['"]/g))
      .slice(0, 30).map(m => m[1]!);
    return { path, present: true, size: entry.size, includes };
  });
  return {
    kind: "pinned-wordpress-php-source-inspection-not-execution",
    sha256: sha, archiveBytes: bytes.byteLength, indexedEntries: entries.length,
    observations,
    interpretation: "Only static file sizes and literal require/include hints; does not measure actual PHP CPU, dynamic includes, WordPress query work or plugin hooks.",
  };
}
export function boundedLogTail(input: string, limit = 32_768) {
  return input.length <= limit ? input : input.slice(-limit);
}
const DEFAULT_PORT = 18879;
export async function runWorkerd(port = DEFAULT_PORT): Promise<WorkerdSample> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid local port");
  const root = join(import.meta.dir, "..");
  // Wrangler's Miniflare HTTP forwarding requires Node/undici dispatcher.
  // Running Wrangler with Bun returns a misleading HTTP 503 for every route.
  const command = "node";
  const child = Bun.spawn([command, join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--config", "wrangler.native.jsonc",
    "--ip", "127.0.0.1", "--port", String(port), "--show-interactive-dev-session=false",
    "--var", "MICROWP_STAGING_MODE:isolated-probe-only"], {
    cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: {...process.env, BROWSER: "none", WRANGLER_SEND_METRICS: "false"},
  });
  let logs = "";
  let logHead = "";
  const drain = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, {stream: true});
        if (logHead.length < 4000) logHead = (logHead + chunkText).slice(0, 4000);
        logs = boundedLogTail(logs + chunkText);
      }
    } finally { reader.releaseLock(); }
  };
  const drains = [drain(child.stdout), drain(child.stderr)];
  const rootUrl = "http://127.0.0.1:" + port;
  const ready = async () => {
    const deadline = performance.now() + 45_000;
    while (performance.now() < deadline) {
      if (child.exitCode !== null) throw Error("Local workerd exited before readiness");
      try {
        const resp = await fetch(rootUrl + "/__microwp/native-health", {signal: AbortSignal.timeout(1200)});
        if (resp.ok) return;
      } catch { /* worker not ready */ }
      await Bun.sleep(300);
    }
    throw Error("Local workerd health readiness timed out; verify Node.js launcher and local Wrangler logs");
  };
  const runRequest = async (): Promise<{status:number; form:boolean; timing:PhaseSample}> => {
    const before = performance.now();
    // Client CPU/RSS are NOT workerd CPU/RSS; retain null rather than attributing the wrong process.
    const resp = await fetch(rootUrl + "/wp-admin/install.php?step=1", {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(45_000),
    });
    const body = await resp.text();
    if (body.length > 2 * 1024 * 1024) throw Error("Oversized installer output");
    return {
      status:resp.status, form:body.includes("weblog_title"),
      timing:{wallMs:Number((performance.now() - before).toFixed(3)),cpuMs:null,rssBeforeBytes:null,rssAfterBytes:null},
    };
  };
  try {
    await ready();
    const first = await runRequest();
    const second = await runRequest();
    const marks = extractBootstrapMarkers(logs);
    return {
      kind:"local-workerd-wordpress-php-bootstrap",
      initAndFirstInstaller:first.timing, repeatedInstaller:second.timing,
      ...marks,
      statusCodes:[first.status,second.status],
      installerForm:[first.form,second.form],
      phaseIsolation:"first request includes PHP init, MEMFS mount, wp-settings and installer; subsequent request includes wp-settings and installer; these are NOT isolated CPU values",
    };
  } catch (error) {
    throw new Error("Local workerd profiling failed: " + (error instanceof Error ? error.message : String(error)) + "; child log head: " + logHead + "; child log tail: " + boundedLogTail(logs, 1800));
  } finally {
    child.kill();
    await Promise.race([child.exited, Bun.sleep(3000)]);
    // Drain pipe streams (do not block indefinitely if a child did not exit).
    void drains;
  }
}
if (import.meta.main) {
  const mode = process.argv[2] ?? "--inspect";
  if (mode === "--inspect") console.log(JSON.stringify(inspectBootstrap(),null,2));
  else if (mode === "--workerd") {
    const sample = await runWorkerd();
    if (!validatePhaseSamples(sample)) throw Error("Invalid sample bounds");
    console.log(JSON.stringify(sample,null,2));
    if (!sample.installerForm.every(Boolean) || !sample.statusCodes.every(x => x === 200))
      process.exitCode = 1;
  } else throw Error("Usage: bun scripts/profile-wordpress-php-bootstrap.ts --inspect|--workerd");
}
