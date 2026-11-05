import { describe, test, expect } from "bun:test";
import { boundedLogTail, extractBootstrapMarkers, finiteLimit, inspectBootstrap, validatePhaseSamples } from "../scripts/profile-wordpress-php-bootstrap";

describe("bounded local WordPress PHP bootstrap profiler", () => {
  test("inspects only pinned, sha-verified WordPress PHP source files", () => {
    const x = inspectBootstrap();
    expect(x.kind).toBe("pinned-wordpress-php-source-inspection-not-execution");
    expect(x.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(x.indexedEntries).toBeGreaterThan(1000);
    expect(x.observations.some(p => p.path === "wp-settings.php" && p.present)).toBe(true);
    expect(x.observations.some(p => p.path === "wp-admin/install.php" && p.present)).toBe(true);
    expect(x.observations.every(p => p.size <= 1048576 && p.includes.length <= 30)).toBe(true);
  });
  test("parses bounded local workerd phase markers only", () => {
    expect(extractBootstrapMarkers("WASM_READY_MS 21\nZIP_READY_MS 33\nCONFIG_READY_MS 40")).toEqual({
      wasmReadyMsFromLog:21, zipReadyMsFromLog:33, configReadyMsFromLog:40,
    });
    expect(extractBootstrapMarkers("WASM_READY_MS nonsense")).toEqual({
      wasmReadyMsFromLog:null,zipReadyMsFromLog:null,configReadyMsFromLog:null,
    });
  });
  test("rejects invalid, oversized and negative metrics", () => {
    expect(finiteLimit(-1,100)).toBe(false);
    expect(finiteLimit(Number.POSITIVE_INFINITY,100)).toBe(false);
    expect(finiteLimit(101,100)).toBe(false);
    expect(finiteLimit(99,100)).toBe(true);
    expect(validatePhaseSamples({
      kind:"local-workerd-wordpress-php-bootstrap",
      initAndFirstInstaller:{wallMs:4,cpuMs:null,rssBeforeBytes:null,rssAfterBytes:null},
      repeatedInstaller:{wallMs:2,cpuMs:null,rssBeforeBytes:null,rssAfterBytes:null},
      wasmReadyMsFromLog:1,zipReadyMsFromLog:2,configReadyMsFromLog:3,
      statusCodes:[200,200],installerForm:[true,true],
      phaseIsolation:"first request includes PHP init, MEMFS mount, wp-settings and installer; subsequent request includes wp-settings and installer; these are NOT isolated CPU values",
    })).toBe(true);
  });
  test("caps accumulated process output", () => {
    expect(boundedLogTail("x".repeat(500),128)).toHaveLength(128);
    expect(boundedLogTail("abc",128)).toBe("abc");
  });
});
