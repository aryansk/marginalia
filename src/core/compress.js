// compress.js — per-message gzip <-> base64 codec for transcript blobs.
// gzipToB64 turns ONE message's text into a compressed base64 string; b64ToText
// inverts it. Built on the platform's native CompressionStream /
// DecompressionStream ("gzip") — no bundled deflate. This helper never touches
// storage; the store layer (store.js) carries blobs as opaque strings and the
// SOLE decompress site is the export path. Blobs live in a record's `blobs`
// map keyed by fp.hash + ":" + fp.len (both fingerprint parts — hash alone
// could collide and render the wrong text under a turn).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.compress = (function () {
  // Bytes <-> binary string must be chunked: String.fromCharCode.apply (or a
  // spread) over a whole multi-hundred-KB Uint8Array overflows the engine's
  // argument-count limit and either throws or silently corrupts. 0x8000 args
  // per call is safely under every engine's cap.
  var CHUNK = 0x8000;

  function bytesToB64(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Run `bytes` through a (De)CompressionStream and collect the full output.
  async function pipe(bytes, stream) {
    var writer = stream.writable.getWriter();
    // Don't await the write before reading: the transform's internal queue can
    // fill on large inputs, parking the writer until someone drains readable.
    // Trap the write-side error instead of letting the promise reject unhandled
    // while the read loop is throwing the same underlying stream error.
    var writeErr = null;
    var writing = writer
      .write(bytes)
      .then(function () {
        return writer.close();
      })
      .catch(function (e) {
        writeErr = e;
      });
    var reader = stream.readable.getReader();
    var chunks = [];
    var total = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      total += r.value.length;
    }
    await writing;
    if (writeErr) throw writeErr;
    var out = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], off);
      off += chunks[i].length;
    }
    return out;
  }

  // gzipToB64(str) -> Promise<base64 string of the gzipped UTF-8 bytes>.
  async function gzipToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var gz = await pipe(bytes, new CompressionStream("gzip"));
    return bytesToB64(gz);
  }

  // b64ToText(b64) -> Promise<original message text>.
  async function b64ToText(b64) {
    var gz = b64ToBytes(b64);
    var bytes = await pipe(gz, new DecompressionStream("gzip"));
    return new TextDecoder().decode(bytes);
  }

  return { gzipToB64: gzipToB64, b64ToText: b64ToText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.compress;
