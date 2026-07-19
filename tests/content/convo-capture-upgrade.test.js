// @vitest-environment jsdom
// Stale-partial upgrade: a turn indexed mid-stream (or before late hydration)
// carries a fingerprint that never appears in the DOM again, which used to
// wedge merge licensing forever — the index froze at the first captured
// window while blobs banked unindexed, so the NotebookLM export contained
// only the annotated turns. Capture now re-keys a stored entry to the live
// turn that provably GREW out of it (same role, strictly longer, stored head
// is a prefix of the live head) before testing the anchoring conditions.
import { describe, it, expect, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function fakeBrowser() {
  const data = {};
  return {
    _data: data,
    storage: {
      local: {
        get: async (k) => {
          if (k == null) return structuredClone(data);
          const keys = Array.isArray(k) ? k : [k];
          const out = {};
          keys.forEach((key) => {
            if (key in data) out[key] = structuredClone(data[key]);
          });
          return out;
        },
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (keys) =>
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]),
      },
    },
  };
}

const FILES = [
  "src/shared/settings-schema.js",
  "src/shared/config.js",
  "src/core/turn-id.js",
  "src/core/convo-merge.js",
  "src/core/backup.js",
  "src/core/compress.js",
  "src/content/store.js",
  "src/content/convo-capture.js",
];

function setLiveTurns(GA, defs) {
  const els = defs.map((d, i) => ({ _text: d.text, _i: i }));
  GA.turns = {
    findTurns: vi.fn(() => els.map((el, i) => ({ el, role: defs[i].role }))),
    textOf: vi.fn((el) => el._text),
    fingerprintOf: vi.fn((el) => GA.core.turnId.fingerprint(el._text)),
  };
}

function setup() {
  const b = fakeBrowser();
  const GA = loadGA(FILES, { browser: b });
  GA.provider = "gemini";
  GA.getSessionId = () => "gemini:c1";
  GA.threadController = { threads: () => [{ id: "t" }] };
  return { GA, b };
}

const fpOf = (GA, text) => GA.core.turnId.fingerprint(text);
const keyOf = (GA, text) => {
  const fp = fpOf(GA, text);
  return fp.hash + ":" + fp.len;
};
const bucket = (b) => b._data["ga:convo:gemini:c1"];

const Q1 = { role: "user", text: "What is a monad?" };
const A1p = { role: "model", text: "A monad is a monoid" }; // mid-stream partial
const A1 = { role: "model", text: "A monad is a monoid in the category of endofunctors." };
const Q2 = { role: "user", text: "Give me an example." };
const A2 = { role: "model", text: "Maybe/Option is the classic example." };

describe("stale-partial upgrade", () => {
  it("re-keys a mid-stream partial to the completed turn once the stream settles", async () => {
    const { GA, b } = setup();

    setLiveTurns(GA, [Q1, A1p]); // annotate while streaming -> immediate capture
    await GA.convoCapture.capture();
    setLiveTurns(GA, [Q1, A1]); // settle capture sees the completed answer
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1].map((t) => fpOf(GA, t.text)));
    expect(rec.turns.map((t) => t.head)).toEqual(
      [Q1, A1].map((t) => GA.core.turnId.indexHead(t.text)),
    );
    // the superseded partial's blob is unreachable (its fp can never be seen
    // again) — deleted; the completed turn's blob is banked
    expect(rec.blobs[keyOf(GA, A1p.text)]).toBeUndefined();
    expect(await GA.core.compress.b64ToText(rec.blobs[keyOf(GA, A1.text)])).toBe(A1.text);
  });

  it("END-TO-END: annotate mid-stream, settle, converse on — every turn indexed and decodable", async () => {
    const { GA, b } = setup();

    setLiveTurns(GA, [Q1, A1p]);
    await GA.convoCapture.capture();
    setLiveTurns(GA, [Q1, A1]);
    await GA.convoCapture.capture();
    setLiveTurns(GA, [Q1, A1, Q2, A2]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1, Q2, A2].map((t) => fpOf(GA, t.text)));
    for (const t of [Q1, A1, Q2, A2]) {
      expect(await GA.core.compress.b64ToText(rec.blobs[keyOf(GA, t.text)])).toBe(t.text);
    }
  });

  it("the upgrade persists even on the unanchored banking path, so a later bridging window can merge", async () => {
    const { GA, b } = setup();

    setLiveTurns(GA, [Q1, A1p]);
    await GA.convoCapture.capture();
    // window shows the grown turn plus newer ones, but NOT Q1: a single
    // shared key doesn't license a merge (documented cautious path) — yet the
    // re-keyed A1 must be saved, or the index would still hold a fingerprint
    // that can never anchor again
    setLiveTurns(GA, [A1, Q2, A2]);
    await GA.convoCapture.capture();

    let rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1].map((t) => fpOf(GA, t.text)));
    expect(rec.blobs[keyOf(GA, Q2.text)]).toBeDefined(); // banked, awaiting an anchor
    expect(rec.blobs[keyOf(GA, A2.text)]).toBeDefined();

    // a bridging window sharing the unique adjacent pair (Q1, A1) merges,
    // indexing the previously banked turns in order
    setLiveTurns(GA, [Q1, A1, Q2, A2]);
    await GA.convoCapture.capture();

    rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1, Q2, A2].map((t) => fpOf(GA, t.text)));
  });

  it("no upgrade when the live turn is not strictly longer (a regenerate may share the opening at equal length)", async () => {
    const { GA, b } = setup();
    const sameLen = { role: "model", text: "A monad is a monoiX" }; // same normalized length as A1p

    setLiveTurns(GA, [Q1, A1p]);
    await GA.convoCapture.capture();
    setLiveTurns(GA, [Q1, sameLen]);
    await GA.convoCapture.capture();

    // no growth evidence -> no upgrade; anchoring is licensed by Q1's...
    // actually [Q1,A1p] vs [Q1,sameLen] share no pair and A1p is absent, so
    // the capture banks blobs and keeps the index — the documented cautious path
    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1p].map((t) => fpOf(GA, t.text)));
    expect(rec.blobs[keyOf(GA, sameLen.text)]).toBeDefined(); // banked, not lost
  });

  it("no upgrade when the opening differs (regenerated answer is a different turn, both texts survive)", async () => {
    const { GA, b } = setup();
    const regen = {
      role: "model",
      text: "Different opening entirely, but much longer than the partial was.",
    };

    setLiveTurns(GA, [Q1, A1p]);
    await GA.convoCapture.capture();
    setLiveTurns(GA, [Q1, regen]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1p].map((t) => fpOf(GA, t.text)));
    expect(rec.blobs[keyOf(GA, A1p.text)]).toBeDefined(); // old content never deleted
    expect(rec.blobs[keyOf(GA, regen.text)]).toBeDefined();
  });

  it("no upgrade across roles even when the text grew", async () => {
    const { GA, b } = setup();
    const grownAsUser = { role: "user", text: A1.text };

    setLiveTurns(GA, [Q1, A1p]);
    await GA.convoCapture.capture();
    setLiveTurns(GA, [Q1, grownAsUser]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1p].map((t) => fpOf(GA, t.text)));
  });

  it("an entry still mounted verbatim is never upgraded onto a longer same-opening sibling", async () => {
    const { GA, b } = setup();
    const short = { role: "model", text: "Yes." };
    const longer = { role: "model", text: "Yes. And here is the elaboration you asked for." };

    setLiveTurns(GA, [short]);
    await GA.convoCapture.capture();
    // both mounted: the stored `short` matches exactly and must stay itself;
    // `longer` joins as a NEW turn via the ordinary subsequence merge
    setLiveTurns(GA, [short, longer]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([short, longer].map((t) => fpOf(GA, t.text)));
    expect(rec.blobs[keyOf(GA, short.text)]).toBeDefined();
  });

  it("a live turn already indexed exactly is never claimed as an upgrade target (no phantom duplicates)", async () => {
    const { GA, b } = setup();
    // stored: a stale partial of A1 AND the full A1 itself (e.g. from an
    // imported archive). The full turn's live twin must not be claimed by the
    // partial — that would index A1 twice.
    const seeded = {
      provider: "gemini",
      id: "c1",
      title: "t",
      url: "u",
      capturedAt: 1,
      turns: [
        {
          role: A1p.role,
          fp: fpOf(GA, A1p.text),
          head: GA.core.turnId.indexHead(A1p.text),
          order: 0,
        },
        { role: A1.role, fp: fpOf(GA, A1.text), head: GA.core.turnId.indexHead(A1.text), order: 1 },
      ],
      blobs: {
        [keyOf(GA, A1p.text)]: await GA.core.compress.gzipToB64(A1p.text),
        [keyOf(GA, A1.text)]: await GA.core.compress.gzipToB64(A1.text),
      },
    };
    b._data["ga:convo:gemini:c1"] = seeded;

    setLiveTurns(GA, [A1]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    const a1Key = JSON.stringify(fpOf(GA, A1.text));
    expect(rec.turns.filter((t) => JSON.stringify(t.fp) === a1Key)).toHaveLength(1);
    expect(rec.turns.map((t) => t.fp)).toEqual([A1p, A1].map((t) => fpOf(GA, t.text)));
  });

  it("legacy entries without heads are left alone — capture stays on the cautious banking path", async () => {
    const { GA, b } = setup();
    const seeded = {
      provider: "gemini",
      id: "c1",
      title: "t",
      url: "u",
      capturedAt: 1,
      turns: [
        { role: Q1.role, fp: fpOf(GA, Q1.text), order: 0 },
        { role: A1p.role, fp: fpOf(GA, A1p.text), order: 1 },
      ],
      blobs: {
        [keyOf(GA, Q1.text)]: await GA.core.compress.gzipToB64(Q1.text),
        [keyOf(GA, A1p.text)]: await GA.core.compress.gzipToB64(A1p.text),
      },
    };
    b._data["ga:convo:gemini:c1"] = seeded;

    setLiveTurns(GA, [Q1, A1]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    // no head -> no growth evidence -> no upgrade... but Q1 is mounted
    // verbatim, so it backfills its own head for the next pass
    expect(rec.turns.map((t) => t.fp)).toEqual([Q1, A1p].map((t) => fpOf(GA, t.text)));
    expect(rec.turns[0].head).toBe(GA.core.turnId.indexHead(Q1.text));
    expect(rec.turns[1].head).toBeUndefined();
    expect(rec.blobs[keyOf(GA, A1.text)]).toBeDefined(); // banked for later
  });

  it("a deleted partial blob key shared by ANOTHER indexed turn is preserved", async () => {
    const { GA, b } = setup();
    // The partial's text also exists verbatim as a USER turn: same blob key
    // (blob keys carry no role). Upgrading the model partial must not delete
    // the blob out from under the user turn's index entry.
    const twinUser = { role: "user", text: A1p.text };

    setLiveTurns(GA, [twinUser, A1p]);
    await GA.convoCapture.capture();
    setLiveTurns(GA, [twinUser, A1]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([twinUser, A1].map((t) => fpOf(GA, t.text)));
    expect(await GA.core.compress.b64ToText(rec.blobs[keyOf(GA, twinUser.text)])).toBe(
      twinUser.text,
    );
  });
});
