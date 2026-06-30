// sha3.js — pure SHA3-512 (FIPS 202), the one primitive WebCrypto doesn't
// provide. Needed only to compute ChatGPT's Sentinel proof-of-work token (see
// payload.js / client.js). Keccak-f[1600] with 64-bit BigInt lanes — short
// inputs + low PoW difficulty mean speed is a non-issue. Unit-tested against the
// official SHA3-512 test vectors.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.chatgpt = GA.chatgpt || {};

GA.chatgpt.sha3 = (function () {
  const MASK = (1n << 64n) - 1n;

  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];

  // rho rotation offsets r[x][y], flattened by lane index (x + 5*y)
  const ROT = [
    0n, 1n, 62n, 28n, 27n,
    36n, 44n, 6n, 55n, 20n,
    3n, 10n, 43n, 25n, 39n,
    41n, 45n, 15n, 21n, 8n,
    18n, 2n, 61n, 56n, 14n,
  ];

  function rotl(x, n) {
    if (n === 0n) return x & MASK;
    return ((x << n) | (x >> (64n - n))) & MASK;
  }

  function keccakF(A) {
    for (let round = 0; round < 24; round++) {
      const C = new Array(5);
      for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
      const D = new Array(5);
      for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D[x];

      const B = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++) {
          const idx = x + 5 * y;
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[idx], ROT[idx]);
        }

      for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++)
          A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & MASK & B[((x + 2) % 5) + 5 * y]);

      A[0] ^= RC[round];
    }
    return A;
  }

  function sha3_512(input) {
    const RATE = 72; // 576 bits
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;

    // pad10*1 with the SHA-3 domain suffix 0x06
    const padLen = RATE - (bytes.length % RATE);
    const padded = new Uint8Array(bytes.length + padLen);
    padded.set(bytes);
    padded[bytes.length] = 0x06;
    padded[padded.length - 1] |= 0x80;

    const A = new Array(25).fill(0n);
    for (let off = 0; off < padded.length; off += RATE) {
      for (let i = 0; i < RATE / 8; i++) {
        let lane = 0n;
        for (let b = 0; b < 8; b++) lane |= BigInt(padded[off + i * 8 + b]) << BigInt(8 * b);
        A[i] ^= lane;
      }
      keccakF(A);
    }

    let hex = "";
    for (let i = 0; i < 8; i++) {
      let lane = A[i];
      for (let b = 0; b < 8; b++) {
        hex += Number(lane & 0xffn).toString(16).padStart(2, "0");
        lane >>= 8n;
      }
    }
    return hex;
  }

  return { sha3_512 };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.chatgpt.sha3;
