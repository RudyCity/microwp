import { indexZip, type ZipEntry } from "./zip-files";

/**
 * Experimental, cold-only ZIP central directory indexer.
 * No global caches, no inflation, no changes to the active WordPress mount.
 * Non-ASCII names and nonstandard archives defer to the original validator.
 */
export function indexZipFastpath(archive: Uint8Array): ZipEntry[] {
  if (archive.byteLength < 22) return indexZip(archive);
  const length = archive.byteLength;
  const view = new DataView(archive.buffer, archive.byteOffset, length);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let eocd = -1;
  for (let at = length - 22, floor = Math.max(0, length - 65557); at >= floor; at--) {
    if (u32(at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) return indexZip(archive);
  const count = u16(eocd + 10);
  if (count > 4096 || count !== u16(eocd + 8)) return indexZip(archive);
  let pos = u32(eocd + 16);
  let total = 0;
  const result: ZipEntry[] = [];
  const seen = new Set<string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > length || u32(pos) !== 0x02014b50) return indexZip(archive);
    const compression = u16(pos + 10);
    const compressed = u32(pos + 20);
    const size = u32(pos + 24);
    const nameLength = u16(pos + 28);
    const extra = u16(pos + 30);
    const comment = u16(pos + 32);
    const localOffset = u32(pos + 42);
    const next = pos + 46 + nameLength + extra + comment;
    if (next > length || nameLength === 0 || size > 1048576 ||
        (compression !== 0 && compression !== 8)) return indexZip(archive);
    const nameStart = pos + 46;
    // ASCII-only fastpath: other encodings get exact legacy decoding/validation.
    for (let j = nameStart; j < nameStart + nameLength; j++) {
      if (archive[j]! >= 128) return indexZip(archive);
    }
    const name = decoder.decode(archive.subarray(nameStart, nameStart + nameLength));
    if (!/\.(?:php|json|css|html|txt|xml)$/.test(name) ||
        name[0] === "/" || name.includes("\\") || name.includes("//")) return indexZip(archive);
    // A path component must not be empty, '.'/'..', or dot-prefixed.
    if (name[0] === "." || name.includes("/.") || name.endsWith("/")) return indexZip(archive);
    if (seen.has(name)) return indexZip(archive);
    seen.add(name);
    total += size;
    if (total > 40 * 1024 * 1024) return indexZip(archive);
    if (localOffset + 30 > length || u32(localOffset) !== 0x04034b50) return indexZip(archive);
    const dataStart = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    if (dataStart + compressed > length) return indexZip(archive);
    result.push({name, compression: compression as 0 | 8, offset: dataStart, compressed, size});
    pos = next;
  }
  return result;
}
