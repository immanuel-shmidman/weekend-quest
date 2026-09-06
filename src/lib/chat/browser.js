/**
 * Browser adapter. The ONLY file in this directory that touches web APIs
 * beyond TextDecoder/Intl; the Node CLI must never import it.
 *
 * The export never leaves the device: it is read from a `File` into memory,
 * inflated with the browser's own DecompressionStream, parsed, and discarded.
 */

import { decodeExport } from "./zip.js";

/**
 * Raw-deflate inflate via the streams API (`deflate-raw` is supported in
 * Chrome 103+, Safari 16.4+, Firefox 113+).
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function inflateRawBrowser(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("this browser cannot unzip the export — please upload the .txt from inside the zip instead");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a WhatsApp export chosen in an `<input type="file">` or dropped on the
 * page. Accepts the .zip WhatsApp produces or the .txt from inside it.
 *
 * @param {File | Blob} file
 * @returns {Promise<{ text: string, entryName: string | null, bytes: number }>}
 */
export async function readExportFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeExport(bytes, inflateRawBrowser);
}
