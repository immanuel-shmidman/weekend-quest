/**
 * Read a WhatsApp export — a .zip or a bare .txt — from bytes.
 *
 * Reads the CENTRAL DIRECTORY rather than the local file headers. WhatsApp
 * writes its zips in streaming mode, which leaves the compressed and
 * uncompressed sizes as zero in the local header (they land in a trailing data
 * descriptor instead). The central directory always carries the real sizes, so
 * it is both the correct and the simpler thing to parse.
 *
 * Inflate is injected so this file has no environment dependency:
 *   Node     -> zlib.inflateRawSync
 *   browser  -> inflateRawBrowser from ./browser.js (DecompressionStream)
 */

/** @typedef {(data: Uint8Array) => Uint8Array | Promise<Uint8Array>} InflateRaw */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * True when the bytes start with a zip local-file-header signature.
 * @param {Uint8Array} bytes
 */
export function isZip(bytes) {
  return bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === SIG_LOCAL;
}

/**
 * Locate and extract the largest `.txt` entry of a zip.
 *
 * @param {Uint8Array} bytes
 * @param {InflateRaw} inflateRaw
 * @returns {Promise<{ name: string, data: Uint8Array, compressedSize: number }>}
 */
export async function readExportZip(bytes, inflateRaw) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @param {number} o */
  const u16 = (o) => dv.getUint16(o, true);
  /** @param {number} o */
  const u32 = (o) => dv.getUint32(o, true);
  const utf8 = new TextDecoder("utf-8");

  // Locate the End Of Central Directory record; scan back from the end since
  // it may be followed by a variable-length comment (max 65,535 bytes).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (u32(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file (no end-of-central-directory record)");

  const entryCount = u16(eocd + 10);
  let ptr = u32(eocd + 16);

  /** @type {null | { name: string, method: number, compSize: number, uncompSize: number, localOffset: number }} */
  let best = null;
  for (let n = 0; n < entryCount; n++) {
    if (u32(ptr) !== SIG_CENTRAL) break;
    const method = u16(ptr + 10);
    const compSize = u32(ptr + 20);
    const uncompSize = u32(ptr + 24);
    const nameLen = u16(ptr + 28);
    const extraLen = u16(ptr + 30);
    const commentLen = u16(ptr + 32);
    const localOffset = u32(ptr + 42);
    const name = utf8.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name.toLowerCase().endsWith(".txt") && (!best || uncompSize > best.uncompSize)) {
      best = { name, method, compSize, uncompSize, localOffset };
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  if (!best) throw new Error("no .txt entry found inside the zip");
  if (best.method !== 0 && best.method !== 8) {
    throw new Error(`unsupported zip compression method ${best.method}`);
  }

  // The data begins after the local header, whose own name/extra lengths may
  // differ from the central directory's.
  const lhNameLen = u16(best.localOffset + 26);
  const lhExtraLen = u16(best.localOffset + 28);
  const dataStart = best.localOffset + 30 + lhNameLen + lhExtraLen;
  const data = bytes.subarray(dataStart, dataStart + best.compSize);
  const raw = best.method === 0 ? data : await inflateRaw(data);
  return { name: best.name, data: raw, compressedSize: best.compSize };
}

/**
 * Decode an export to text, whether it is a zip or a plain .txt.
 *
 * @param {Uint8Array} bytes
 * @param {InflateRaw} inflateRaw
 * @returns {Promise<{ text: string, entryName: string | null, bytes: number }>}
 */
export async function decodeExport(bytes, inflateRaw) {
  const utf8 = new TextDecoder("utf-8"); // strips a BOM if one is present
  if (!isZip(bytes)) return { text: utf8.decode(bytes), entryName: null, bytes: bytes.length };
  const entry = await readExportZip(bytes, inflateRaw);
  return { text: utf8.decode(entry.data), entryName: entry.name, bytes: entry.data.length };
}
