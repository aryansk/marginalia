// @vitest-environment jsdom
// Legacy wedged-record recovery, end to end. Records captured before index
// heads existed can be WEDGED: the index froze at the first annotated window
// (a mid-stream partial's fingerprint never re-appears, so no capture could
// ever anchor again) while every message's blob kept banking unindexed — the
// user-visible symptom being a NotebookLM export that contains only the
// annotated turns. Recovery is a two-step handshake across real modules:
//  1. EXPORT decompresses every indexed blob anyway, so it backfills the
//     missing `head` onto each entry (the sole place plaintext is in hand).
//  2. The NEXT CAPTURE can then recognize the stale partial as a prefix of
//     the completed live turn, upgrade it in place, and anchor the merge.
// A second export then contains the full conversation, with the annotation
// re-homed onto the completed turn via the quote fallback.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function fakeBrowser() {
  const data = {};
  return {
    _data: data,
    runtime: { sendMessage: () => Promise.resolve() },
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
  "src/shared/protocol.js",
  "src/shared/settings-schema.js",
  "src/shared/config.js",
  "src/core/sites.js",
  "src/core/markdown-ast.js",
  "src/core/thread-search.js",
  "src/core/turn-id.js",
  "src/core/backup.js",
  "src/core/compress.js",
  "src/core/transcript.js",
  "src/content/store.js",
  "src/content/convo-capture.js",
  "src/content/util.js",
  "src/content/icons.js",
  "src/content/panel.js",
];

const Q1 = { role: "user", text: "What is a monad?" };
const A1p = { role: "model", text: "A monad is a monoid" }; // captured mid-stream
const A1 = { role: "model", text: "A monad is a monoid in the category of endofunctors." };
const Q2 = { role: "user", text: "Give me an example." };
const A2 = { role: "model", text: "Maybe/Option is the classic example." };

function setLiveTurns(GA, defs) {
  const els = defs.map((d, i) => ({ _text: d.text, _i: i }));
  GA.turns = {
    findTurns: vi.fn(() => els.map((el, i) => ({ el, role: defs[i].role }))),
    textOf: vi.fn((el) => el._text),
    fingerprintOf: vi.fn((el) => GA.core.turnId.fingerprint(el._text)),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  URL.createObjectURL = vi.fn((blob) => {
    URL.createObjectURL.lastBlob = blob;
    return "blob:vitest";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function clickExport(GA) {
  GA.panel.open();
  document
    .querySelector('.ga-modal-header .ga-iconbtn[aria-label="Export conversation for NotebookLM"]')
    .click();
  await vi.waitFor(() => {
    if (!document.querySelector(".ga-toast")) throw new Error("no toast yet");
  });
  const md = await URL.createObjectURL.lastBlob.text();
  document.querySelectorAll(".ga-toast, .ga-modal-overlay").forEach((n) => n.remove());
  return md;
}

describe("wedged legacy record: export backfill -> capture upgrade -> full export", () => {
  it("recovers the full conversation across two exports and one revisit capture", async () => {
    const b = fakeBrowser();
    const GA = loadGA(FILES, { browser: b });
    GA.provider = "gemini";
    GA.getSessionId = () => "gemini:c1";
    GA.warn = vi.fn();
    // The thread was created mid-stream: its anchor fingerprints the PARTIAL.
    const threads = [
      {
        id: "t1",
        anchor: { v: 2, role: "model", turn: GA.core.turnId.fingerprint(A1p.text) },
        selector: { exact: "monoid" },
        messages: [{ role: "user", text: "explain simpler" }],
        createdAt: 1,
      },
    ];
    GA.threadController = { threads: () => threads, expandThreadById: () => {} };
    GA.selection = { anchorEl: () => null };
    GA.gutter = { get: () => null, setActive: () => {}, mode: () => "normal" };

    // ---- build the wedged legacy state ----------------------------------
    // annotate-time capture saw [Q1, A1p]; strip the heads to simulate a
    // record written before they existed
    setLiveTurns(GA, [Q1, A1p]);
    await GA.convoCapture.capture();
    const key = "ga:convo:gemini:c1";
    b._data[key].turns.forEach((t) => delete t.head);
    // later captures could only bank blobs: index still [Q1, A1p], headless
    setLiveTurns(GA, [Q1, A1, Q2, A2]);
    b._data[key].turns.forEach((t) => delete t.head); // keep Q1 headless too
    await GA.convoCapture.capture();
    let rec = b._data[key];
    expect(rec.turns.map((t) => t.fp.len)).toEqual([Q1, A1p].map((t) => t.text.length)); // wedged
    expect(Object.keys(rec.blobs)).toHaveLength(5); // ...but everything banked

    // ---- export #1: the degraded transcript, plus the head backfill ------
    const md1 = await clickExport(GA);
    expect(md1).toContain(Q1.text);
    expect(md1).toContain(A1p.text);
    expect(md1).not.toContain(Q2.text); // still the wedged view
    rec = b._data[key];
    expect(rec.turns.map((t) => t.head)).toEqual(
      [Q1, A1p].map((t) => GA.core.turnId.indexHead(t.text))
    );

    // ---- revisit: the next settle capture can now upgrade and anchor -----
    setLiveTurns(GA, [Q1, A1, Q2, A2]);
    await GA.convoCapture.capture();
    rec = b._data[key];
    expect(rec.turns.map((t) => t.fp)).toEqual(
      [Q1, A1, Q2, A2].map((t) => GA.core.turnId.fingerprint(t.text))
    );

    // ---- export #2: the full conversation, annotation re-homed -----------
    const md2 = await clickExport(GA);
    for (const t of [Q1, A1, Q2, A2]) expect(md2).toContain(t.text);
    expect(md2).not.toContain("Unanchored notes");
    // the annotation callout sits under the COMPLETED answer
    expect(md2.indexOf("explain simpler")).toBeGreaterThan(md2.indexOf(A1.text));
  });

  it("head backfill skips entries whose blob is missing (no text to compute from) and writes nothing when all heads exist", async () => {
    const b = fakeBrowser();
    const GA = loadGA(FILES, { browser: b });
    GA.provider = "gemini";
    GA.getSessionId = () => "gemini:c1";
    GA.warn = vi.fn();
    GA.threadController = { threads: () => [], expandThreadById: () => {} };
    GA.selection = { anchorEl: () => null };
    GA.gutter = { get: () => null, setActive: () => {}, mode: () => "normal" };

    const fp = (t) => GA.core.turnId.fingerprint(t);
    const record = {
      provider: "gemini",
      id: "c1",
      title: "t",
      url: "u",
      capturedAt: 1,
      turns: [
        { role: "user", fp: fp(Q1.text), order: 0 }, // headless, blob present
        { role: "model", fp: fp(A1.text), order: 1 }, // headless, blob MISSING
      ],
      blobs: {
        [fp(Q1.text).hash + ":" + fp(Q1.text).len]: await GA.core.compress.gzipToB64(Q1.text),
      },
    };
    const key = "ga:convo:gemini:c1";
    b._data[key] = record;

    await clickExport(GA);
    let rec = b._data[key];
    expect(rec.turns[0].head).toBe(GA.core.turnId.indexHead(Q1.text));
    expect(rec.turns[1].head).toBeUndefined(); // nothing to compute from

    // second export: every computable head exists -> no further store write
    const save = vi.spyOn(GA.store, "saveConvo");
    await clickExport(GA);
    expect(save).not.toHaveBeenCalled();
  });
});
