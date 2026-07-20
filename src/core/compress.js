// compress.js — per-message gzip <-> base64 codec for transcript blobs.
// gzipToB64 turns ONE message's text into a compressed base64 string; b64ToText
// inverts it. Built on the platform's native CompressionStream /
// DecompressionStream ("gzip") — no bundled deflate. This helper never touches
// storage and knows nothing about blob keys or who (de)compresses what — that
// doctrine lives with the callers (store.js carries blobs opaquely;
// convo-repair.js is the decode site).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.compress = (function () {
  // Bytes <-> binary string must be chunked: String.fromCharCode.apply (or a
  // spread) over a whole multi-hundred-KB Uint8Array overflows the engine's
  // argument-count limit and either throws or silently corrupts. 0x8000 args
  // per call is safely under every engine's cap.
  const CHUNK = 0x8000;

  function bytesToB64(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Run `bytes` through a (De)CompressionStream and collect the full output.
  async function pipe(bytes, stream) {
    const writer = stream.writable.getWriter();
    // Don't await the write before reading: the transform's internal queue can
    // fill on large inputs, parking the writer until someone drains readable.
    // Trap the write-side error instead of letting the promise reject unhandled
    // while the read loop is throwing the same underlying stream error.
    let writeErr = null;
    const writing = writer
      .write(bytes)
      .then(() => writer.close())
      .catch((e) => {
        writeErr = e;
      });
    const reader = stream.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      total += r.value.length;
    }
    await writing;
    if (writeErr) throw writeErr;
    const out = new Uint8Array(total);
    let off = 0;
    for (const chunk of chunks) {
      out.set(chunk, off);
      off += chunk.length;
    }
    return out;
  }

  // gzipToB64(str) -> Promise<base64 string of the gzipped UTF-8 bytes>.
  async function gzipToB64(str) {
    const bytes = new TextEncoder().encode(str);
    const gz = await pipe(bytes, new CompressionStream("gzip"));
    return bytesToB64(gz);
  }

  // b64ToText(b64) -> Promise<original message text>.
  async function b64ToText(b64) {
    const gz = b64ToBytes(b64);
    const bytes = await pipe(gz, new DecompressionStream("gzip"));
    return new TextDecoder().decode(bytes);
  }

  return { gzipToB64, b64ToText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.compress;
