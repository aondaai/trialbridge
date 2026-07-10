/**
 * A minimal, dependency-free ZIP reader.
 *
 * DOCX, XLSX, and eCTD packages are all ZIP containers, so this one primitive
 * unlocks three envelope formats with zero new npm deps (the repo already
 * documents npm fragility under its colon-in-path root). We parse the PKZIP
 * central directory by hand and inflate entries with Node's built-in `zlib`.
 *
 * Scope: the two compression methods real Office/eCTD files use — 0 (stored)
 * and 8 (deflate). Encrypted or other-method entries throw a clear error rather
 * than returning garbage. This is a reader, not a full archiver.
 */

import { inflateRawSync } from "node:zlib";

const SIG_EOCD = 0x06054b50; // End Of Central Directory
const SIG_CEN = 0x02014b50; // Central directory file header
const SIG_LOC = 0x04034b50; // Local file header

/** Parse a ZIP archive into a map of entry name → uncompressed bytes. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view, bytes.byteLength);
  const entryCount = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory start offset

  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== SIG_CEN) {
      throw new Error(`zip: bad central directory header at ${ptr}`);
    }
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = utf8(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // Only directory entries end in "/"; skip them (no data).
    if (!name.endsWith("/")) {
      out.set(name, readLocalEntry(bytes, view, localOffset, method, compSize));
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Read + decompress one entry given its central-directory info. */
function readLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compSize: number,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== SIG_LOC) {
    throw new Error(`zip: bad local file header at ${localOffset}`);
  }
  // The local header repeats name/extra lengths, which can differ from the
  // central directory's — the data starts after THEM.
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const comp = bytes.subarray(dataStart, dataStart + compSize);

  if (method === 0) return comp.slice(); // stored
  if (method === 8) return new Uint8Array(inflateRawSync(comp)); // deflate
  throw new Error(`zip: unsupported compression method ${method} (only 0/8)`);
}

/** Scan backwards for the EOCD signature (record is near the file end). */
function findEocd(view: DataView, len: number): number {
  // EOCD is >=22 bytes; a zip comment can push it up to 64KB from the end.
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error("zip: End Of Central Directory not found (not a zip archive?)");
}

/** Read one named entry as UTF-8 text, or throw if absent. */
export function unzipTextEntry(bytes: Uint8Array, name: string): string {
  const entry = unzip(bytes).get(name);
  if (!entry) throw new Error(`zip: entry "${name}" not found`);
  return utf8(entry);
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
