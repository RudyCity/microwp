import { describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { indexZip, inflateEntry } from "../src/php/zip-files";
import { indexZipFastpath } from "../src/php/zip-index-fastpath";

function archive(files: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strToU8(data)])));
}
function same(bytes: Uint8Array) {
  expect(indexZipFastpath(bytes)).toEqual(indexZip(bytes));
}
describe("cold ZIP index fastpath prototype", () => {
  test("matches existing offsets, sizes, compression and names", () => {
    const bytes = archive({"index.php":"<?php echo 1;", "wp-admin/install.php":"<?php exit;", "wp-includes/info.json":"{}", "assets/style.css":"body{}"});
    same(bytes);
    for (const e of indexZipFastpath(bytes)) {
      expect(inflateEntry(bytes, e)).toEqual(inflateEntry(bytes, indexZip(bytes).find(x => x.name === e.name)!));
    }
  });
  test("supports sliced Uint8Array backing buffers", () => {
    const bytes = archive({"wp-load.php":"<?php"});
    const padded = new Uint8Array(bytes.length + 17);
    padded.set(bytes, 7);
    same(padded.subarray(7, 7 + bytes.length));
  });
  test("falls back for non-ASCII filenames with legacy parity", () => {
    same(archive({"café.php":"<?php"}));
  });
  test("matches existing rejection of traversal, hidden and unsupported entries", () => {
    for (const name of ["../evil.php", ".hidden.php", "some/.hidden.php", "evil.js", "/absolute.php"]) {
      const bytes = archive({[name]:"x"});
      expect(() => indexZip(bytes)).toThrow();
      expect(() => indexZipFastpath(bytes)).toThrow();
    }
  });
  test("rejects truncated or corrupt central directory like legacy", () => {
    for (const bytes of [new Uint8Array([1,2]), new Uint8Array(22), archive({"ok.php":"ok"}).subarray(0, 20)]) {
      expect(() => indexZipFastpath(bytes)).toThrow();
    }
  });
  test("rejects duplicate central-directory names like legacy", () => {
    const bytes = archive({"a.php":"x", "b.php":"y"});
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    const first = view.getUint32(eocd + 16, true);
    const second = first + 46 + view.getUint16(first + 28, true) + view.getUint16(first + 30, true) + view.getUint16(first + 32, true);
    bytes.set(new TextEncoder().encode("a.php"), second + 46);
    expect(() => indexZip(bytes)).toThrow("unsafe");
    expect(() => indexZipFastpath(bytes)).toThrow("unsafe");
  });
  test("is deterministic across repeated cold calls without shared mutable caching", () => {
    const bytes = archive({"index.php":"first"});
    const original = indexZipFastpath(bytes);
    expect(indexZipFastpath(bytes)).toEqual(original);
    const changed = archive({"index.php":"different content"});
    same(changed);
    expect(indexZipFastpath(changed)[0]?.size).not.toBe(original[0]?.size);
  });
});
