// convoRepair.loadDecoded — the system's sole decompress site, extracted from
// the panel's export handler: decode every indexed blob, self-heal corrupt
// entries against a FRESHLY re-loaded record, backfill legacy heads, and never
// resurrect a stale snapshot. Uses the real codec; GA.store is a stub resolved
// call-time. (The end-to-end export flow stays covered by the panel-export and
// transcript-recovery specs.)
import { describe, it, expect, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const FILES = [
  "src/shared/settings-schema.js",
  "src/shared/config.js",
  "src/core/turn-id.js",
  "src/core/compress.js",
  "src/content/convo-repair.js",
];

function makeGA({ record = null } = {}) {
  const GA = loadGA(FILES);
  GA.warn = vi.fn();
  GA.store = {
    loadConvo: vi.fn(async () => record),
    saveConvo: vi.fn(async () => {}),
  };
  return GA;
}

// A record exactly as capture stores it: plaintext turn index (with heads) +
// per-message gzip blobs keyed by BOTH fingerprint parts.
async function makeRecord(GA, msgs, extra = {}) {
  const turns = [];
  const blobs = {};
  for (let i = 0; i < msgs.length; i++) {
    const fp = GA.core.turnId.fingerprint(msgs[i].text);
    turns.push({ role: msgs[i].role, fp, head: GA.core.turnId.indexHead(msgs[i].text), order: i });
    blobs[fp.hash + ":" + fp.len] = await GA.core.compress.gzipToB64(msgs[i].text);
  }
  return Object.assign(
    {
      provider: "gemini",
      id: "abc",
      title: "My Chat",
      url: "https://gemini.google.com/app/abc",
      capturedAt: 1700000000000,
      turns,
      blobs,
    },
    extra,
  );
}

const keyOf = (record, i) => record.turns[i].fp.hash + ":" + record.turns[i].fp.len;

const Q = { role: "user", text: "What is a monad?" };
const A = { role: "model", text: "A monoid in the category of endofunctors." };

describe("convoRepair.loadDecoded — decoding", () => {
  it("returns the decoded record: metadata carried over, every turn's text inflated", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [Q, A]);
    GA = makeGA({ record });

    const decoded = await GA.convoRepair.loadDecoded("gemini:abc");

    expect(GA.store.loadConvo).toHaveBeenCalledWith("gemini:abc");
    expect(decoded.provider).toBe("gemini");
    expect(decoded.id).toBe("abc");
    expect(decoded.title).toBe("My Chat");
    expect(decoded.url).toBe(record.url);
    expect(decoded.capturedAt).toBe(record.capturedAt);
    expect(decoded.turns).toEqual([
      { role: "user", order: 0, fp: record.turns[0].fp, text: Q.text },
      { role: "model", order: 1, fp: record.turns[1].fp, text: A.text },
    ]);
    // clean record: no heal, no write
    expect(GA.store.saveConvo).not.toHaveBeenCalled();
  });

  it("null for a falsy session (no storage read), a missing record, and an empty index", async () => {
    const GA = makeGA();
    expect(await GA.convoRepair.loadDecoded(null)).toBeNull();
    expect(GA.store.loadConvo).not.toHaveBeenCalled();

    expect(await GA.convoRepair.loadDecoded("gemini:abc")).toBeNull(); // record null

    let GA2 = makeGA();
    GA2 = makeGA({ record: await makeRecord(GA2, []) });
    expect(await GA2.convoRepair.loadDecoded("gemini:abc")).toBeNull();
  });

  it("a missing blob decodes to empty text and triggers NO heal (missing is not corrupt)", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [Q, A]);
    delete record.blobs[keyOf(record, 1)];
    GA = makeGA({ record });

    const decoded = await GA.convoRepair.loadDecoded("gemini:abc");

    expect(decoded.turns.map((t) => t.text)).toEqual([Q.text, ""]);
    expect(GA.store.loadConvo).toHaveBeenCalledTimes(1); // no re-load
    expect(GA.store.saveConvo).not.toHaveBeenCalled();
  });
});

describe("convoRepair.loadDecoded — self-heal", () => {
  it("a corrupt blob decodes empty AND is deleted from the RE-LOADED record, not the stale snapshot", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [Q, A]);
    const badKey = keyOf(record, 1);
    record.blobs[badKey] = "AAAA"; // valid base64, not gzip — b64ToText rejects
    // a concurrent capture re-wrote the record mid-decode: same corrupt entry
    // plus a freshly banked blob the stale snapshot lacks
    const fresh = JSON.parse(JSON.stringify(record));
    fresh.blobs["123:9"] = "freshly-banked";
    GA = makeGA({ record });
    GA.store.loadConvo = vi.fn(async () =>
      GA.store.loadConvo.mock.calls.length > 1 ? fresh : record,
    );

    const decoded = await GA.convoRepair.loadDecoded("gemini:abc");

    expect(decoded.turns.map((t) => t.text)).toEqual([Q.text, ""]);
    expect(GA.store.loadConvo).toHaveBeenCalledTimes(2);
    const [session, healed] = GA.store.saveConvo.mock.calls[0];
    expect(session).toBe("gemini:abc");
    expect(healed).toBe(fresh); // the re-loaded record is what gets written
    expect(healed.blobs[badKey]).toBeUndefined();
    expect(healed.blobs["123:9"]).toBe("freshly-banked"); // banked data survives
    expect(healed.turns).toHaveLength(2); // index untouched — capture refills the blob
  });

  it("backfills heads onto headless legacy entries whose plaintext is in hand", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [Q, A]);
    record.turns.forEach((t) => delete t.head); // legacy pre-head record
    delete record.blobs[keyOf(record, 1)]; // one entry has nothing to compute from
    GA = makeGA({ record });

    await GA.convoRepair.loadDecoded("gemini:abc");

    const [, healed] = GA.store.saveConvo.mock.calls[0];
    expect(healed.turns[0].head).toBe(GA.core.turnId.indexHead(Q.text));
    expect(healed.turns[1].head).toBeUndefined(); // no blob, no plaintext, no head
  });

  it("skips the write entirely when the record vanished before the heal", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [A]);
    record.blobs[keyOf(record, 0)] = "AAAA";
    GA = makeGA({ record });
    GA.store.loadConvo = vi.fn(async () =>
      GA.store.loadConvo.mock.calls.length > 1 ? null : record,
    );

    const decoded = await GA.convoRepair.loadDecoded("gemini:abc");

    expect(GA.store.saveConvo).not.toHaveBeenCalled(); // never resurrect the snapshot
    expect(decoded.turns).toHaveLength(1); // the decode itself still delivers
  });

  it("a failing heal save is swallowed with GA.warn — the decoded record still returns", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [A]);
    record.blobs[keyOf(record, 0)] = "AAAA";
    GA = makeGA({ record });
    GA.store.saveConvo = vi.fn(async () => {
      throw new Error("quota");
    });

    const decoded = await GA.convoRepair.loadDecoded("gemini:abc");

    expect(GA.store.saveConvo).toHaveBeenCalledTimes(1);
    expect(GA.warn).toHaveBeenCalledWith("transcript self-heal failed", expect.any(Error));
    expect(decoded.turns.map((t) => t.text)).toEqual([""]);
  });
});
