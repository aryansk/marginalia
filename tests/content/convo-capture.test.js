// @vitest-environment jsdom
// convo-capture (T-010): the ga:convo:* bucket is populated from the live DOM
// for ANNOTATED conversations only, reusing GA.turns discovery; compression is
// per-message and only-new (blob key = fp.hash + ":" + fp.len); merging goes
// through GA.store.mergeTurns so progressive reveal in BOTH directions (append
// AND scroll-up prepend) keeps true conversation order; the capture path never
// decompresses anything.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// In-memory browser.storage.local with clone semantics (same as store.test.js).
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
  "src/core/backup.js",
  "src/core/compress.js",
  "src/content/store.js",
  "src/content/convo-capture.js",
];

// Stand-in for GA.turns over a scripted turn list. Capture must reach the page
// exclusively through these three functions.
function setLiveTurns(GA, defs) {
  const els = defs.map((d, i) => ({ _text: d.text, _i: i }));
  GA.turns = {
    findTurns: vi.fn(() => els.map((el, i) => ({ el, role: defs[i].role }))),
    textOf: vi.fn((el) => el._text),
    fingerprintOf: vi.fn((el) => GA.core.turnId.fingerprint(el._text)),
  };
}

function setup({ turns = [], threads = 1, session = "gemini:c1" } = {}) {
  const b = fakeBrowser();
  const GA = loadGA(FILES, { browser: b });
  GA.provider = "gemini";
  GA.getSessionId = () => session;
  GA.threadController = { threads: () => new Array(threads).fill({ id: "t" }) };
  setLiveTurns(GA, turns);
  return { GA, b };
}

const fpOf = (GA, text) => GA.core.turnId.fingerprint(text);
const headOf = (GA, text) => GA.core.turnId.indexHead(text);
const keyOf = (GA, text) => {
  const fp = fpOf(GA, text);
  return fp.hash + ":" + fp.len;
};
const bucket = (b, session = "gemini:c1") => b._data["ga:convo:" + session];

const A = { role: "user", text: "What is a monad?" };
const B = { role: "model", text: "A monad is a monoid in the category of endofunctors." };
const C = { role: "user", text: "Say that again, slower." };
const D = { role: "model", text: "Slower: a monad wraps a value and a context." };
const X = { role: "user", text: "Earlier question, revealed by scrolling up." };
const Y = { role: "model", text: "Earlier answer, revealed by scrolling up." };

describe("convoCapture.capture — basic bucket shape", () => {
  it("writes a convo record whose index matches findTurns and whose blobs are keyed <hash>:<len>", async () => {
    const { GA, b } = setup({ turns: [A, B] });
    document.title = "Monads — Gemini";

    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec).toBeTruthy();
    expect(rec.provider).toBe("gemini");
    expect(rec.id).toBe("c1");
    expect(rec.title).toBe("Monads — Gemini");
    expect(rec.url).toBe(location.href);
    expect(typeof rec.capturedAt).toBe("number");
    // Index mirrors the findTurns mapping: role + fingerprint + plaintext
    // head (stale-partial recovery), order 0..n-1.
    expect(rec.turns).toEqual([
      { role: "user", fp: fpOf(GA, A.text), head: headOf(GA, A.text), order: 0 },
      { role: "model", fp: fpOf(GA, B.text), head: headOf(GA, B.text), order: 1 },
    ]);
    expect(Object.keys(rec.blobs).sort()).toEqual([keyOf(GA, A.text), keyOf(GA, B.text)].sort());
  });

  it("blobs round-trip through the real codec back to each turn's text", async () => {
    const { GA, b } = setup({ turns: [A, B] });

    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(await GA.core.compress.b64ToText(rec.blobs[keyOf(GA, A.text)])).toBe(A.text);
    expect(await GA.core.compress.b64ToText(rec.blobs[keyOf(GA, B.text)])).toBe(B.text);
  });

  it("never decompresses during capture", async () => {
    const { GA } = setup({ turns: [A, B] });
    const spy = vi.spyOn(GA.core.compress, "b64ToText");

    await GA.convoCapture.capture();
    await GA.convoCapture.capture(); // second pass reads the existing record — still no decompress

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("convoCapture.capture — progressive reveal", () => {
  it("APPEND: a later capture adds only the new turns' blobs and extends the index in order", async () => {
    const { GA, b } = setup({ turns: [A, B] });
    await GA.convoCapture.capture();
    const before = bucket(b);

    setLiveTurns(GA, [A, B, C, D]);
    const gzip = vi.spyOn(GA.core.compress, "gzipToB64");
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([A, B, C, D].map((t) => fpOf(GA, t.text)));
    expect(rec.turns.map((t) => t.order)).toEqual([0, 1, 2, 3]);
    // Only C and D were compressed…
    expect(gzip.mock.calls.map((c) => c[0])).toEqual([C.text, D.text]);
    // …and the prior turns' blobs were carried byte-for-byte.
    expect(rec.blobs[keyOf(GA, A.text)]).toBe(before.blobs[keyOf(GA, A.text)]);
    expect(rec.blobs[keyOf(GA, B.text)]).toBe(before.blobs[keyOf(GA, B.text)]);
    expect(Object.keys(rec.blobs)).toHaveLength(4);
  });

  it("SCROLL-UP: older turns prepended by the snapshot land BEFORE the stored ones — true order, renumbered", async () => {
    const { GA, b } = setup({ turns: [A, B, C] });
    await GA.convoCapture.capture();

    setLiveTurns(GA, [X, Y, A, B, C]); // scroll-up revealed X, Y above the fold
    const gzip = vi.spyOn(GA.core.compress, "gzipToB64");
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([X, Y, A, B, C].map((t) => fpOf(GA, t.text)));
    expect(rec.turns.map((t) => t.order)).toEqual([0, 1, 2, 3, 4]);
    // Only the newly-revealed X and Y were compressed.
    expect(gzip.mock.calls.map((c) => c[0])).toEqual([X.text, Y.text]);
  });

  it("a turn whose blob key already exists is never re-compressed (idempotent re-capture)", async () => {
    const { GA, b } = setup({ turns: [A, B] });
    await GA.convoCapture.capture();
    const before = bucket(b);

    const gzip = vi.spyOn(GA.core.compress, "gzipToB64");
    await GA.convoCapture.capture(); // same snapshot again

    expect(gzip).not.toHaveBeenCalled();
    expect(bucket(b).turns).toEqual(before.turns);
    expect(bucket(b).blobs).toEqual(before.blobs);
  });

  it("duplicate identical messages keep BOTH index entries while sharing ONE blob", async () => {
    const cont = { role: "user", text: "continue" };
    const { GA, b } = setup({ turns: [cont, B, cont] });
    const gzip = vi.spyOn(GA.core.compress, "gzipToB64");

    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns).toHaveLength(3);
    expect(rec.turns[0].fp).toEqual(rec.turns[2].fp); // multiset survived the merge
    expect(Object.keys(rec.blobs)).toHaveLength(2);
    // "continue" was compressed once, not once per occurrence.
    expect(gzip.mock.calls.map((c) => c[0])).toEqual([cont.text, B.text]);
  });

  it("DISJOINT windows: an unanchored snapshot banks its blobs but never guesses an index position", async () => {
    // A fast fling across a virtualized list can capture two windows that
    // share no turn. Their relative order is unprovable — merging would have
    // to guess, and a later bridging capture would then duplicate entries.
    const { GA, b } = setup({ turns: [C, D] }); // first capture: bottom window
    await GA.convoCapture.capture();

    setLiveTurns(GA, [A, B]); // fling to the top: disjoint window
    await GA.convoCapture.capture();

    let rec = bucket(b);
    // Index untouched (no guessed ordering)…
    expect(rec.turns.map((t) => t.fp)).toEqual([C, D].map((t) => fpOf(GA, t.text)));
    // …but the disjoint turns' blobs are already banked.
    expect(Object.keys(rec.blobs).sort()).toEqual(
      [A, B, C, D].map((t) => keyOf(GA, t.text)).sort()
    );

    // A bridging capture that overlaps both windows indexes everything, in
    // true order, exactly once — and re-compresses nothing.
    setLiveTurns(GA, [A, B, C, D]);
    const gzip = vi.spyOn(GA.core.compress, "gzipToB64");
    await GA.convoCapture.capture();

    rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([A, B, C, D].map((t) => fpOf(GA, t.text)));
    expect(rec.turns).toHaveLength(4); // no phantom duplicates
    expect(gzip).not.toHaveBeenCalled(); // banked blobs were reused
  });

  it("OVERLAPPING captures serialize: a slow capture cannot clobber a faster later one", async () => {
    const { GA, b } = setup({ turns: [A, B] });
    // Park the FIRST capture mid-compression, like a huge turn would; any
    // capture after it runs unparked (so, without serialization, it would
    // finish first and then be clobbered by the stale save).
    const real = GA.core.compress.gzipToB64;
    let parked = false;
    let release;
    const gate = new Promise((r) => (release = r));
    const gz = vi.spyOn(GA.core.compress, "gzipToB64").mockImplementation(async (s) => {
      if (s === A.text && !parked) {
        parked = true;
        await gate;
      }
      return real(s);
    });

    const slow = GA.convoCapture.capture();
    await vi.waitFor(() => expect(gz).toHaveBeenCalled()); // slow snapshotted [A, B], parked on A
    setLiveTurns(GA, [A, B, C]); // streaming reveals C
    const fast = GA.convoCapture.capture(); // must see [A, B, C] and run AFTER slow
    // Give the second capture every opportunity to run to completion while the
    // first is still parked — unserialized captures would finish here, letting
    // the stale save land LAST and clobber C.
    await new Promise((r) => setTimeout(r, 25));
    release();
    await slow;
    await fast;

    const rec = bucket(b);
    // C survived: the second capture ran against the first one's saved record.
    expect(rec.turns.map((t) => t.fp)).toEqual([A, B, C].map((t) => fpOf(GA, t.text)));
    expect(rec.blobs[keyOf(GA, C.text)]).toBeTruthy();
  });

  it("a slid window (older turns revealed, newest unmounted) still merges via the shared run", async () => {
    const { GA, b } = setup({ turns: [A, B, C] });
    await GA.convoCapture.capture();

    setLiveTurns(GA, [X, Y, A, B]); // scrolled up far enough that C unmounted
    await GA.convoCapture.capture();

    // Stored C is not visible, so the snapshot doesn't supersede the index —
    // but the windows share the adjacent run A,B, which anchors the merge.
    expect(bucket(b).turns.map((t) => t.fp)).toEqual(
      [X, Y, A, B, C].map((t) => fpOf(GA, t.text))
    );
  });

  it("a duplicate message shared across DISJOINT windows is a false anchor — it must not license a merge", async () => {
    // True conversation: X cont Y … D cont Z ("continue" said twice). Two
    // genuinely disjoint windows each contain one occurrence; their shared
    // key proves nothing about relative order.
    const cont = { role: "user", text: "continue" };
    const Xa = { role: "model", text: "first answer" };
    const Ya = { role: "model", text: "second answer" };
    const Da = { role: "model", text: "fifth answer" };
    const Za = { role: "model", text: "sixth answer" };
    const { GA, b } = setup({ turns: [Da, cont, Za] }); // bottom window first
    await GA.convoCapture.capture();

    setLiveTurns(GA, [Xa, cont, Ya]); // fling to the top: disjoint except the duplicate
    await GA.convoCapture.capture();

    // No guessed merge: index unchanged, blobs banked.
    expect(bucket(b).turns.map((t) => t.fp)).toEqual([Da, cont, Za].map((t) => fpOf(GA, t.text)));

    // The bridging capture indexes the whole conversation once, in true order.
    setLiveTurns(GA, [Xa, cont, Ya, Da, cont, Za]);
    await GA.convoCapture.capture();

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual(
      [Xa, cont, Ya, Da, cont, Za].map((t) => fpOf(GA, t.text))
    );
    expect(rec.turns).toHaveLength(6); // no phantom duplicates
  });

  it("a shape-poisoned record (non-array turns, string blobs) is healed, not a permanent wedge", async () => {
    const { GA, b } = setup({ turns: [A, B] });
    b._data["ga:convo:gemini:c1"] = {
      provider: "gemini",
      id: "c1",
      turns: { a: 1 }, // not an array — .filter would throw forever
      blobs: "abc", // not a map — Object.assign would char-spread it
    };

    await GA.convoCapture.capture(); // must not reject

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([A, B].map((t) => fpOf(GA, t.text)));
    expect(Object.keys(rec.blobs).sort()).toEqual(
      [A, B].map((t) => keyOf(GA, t.text)).sort() // no "0"/"1"/"2" char keys
    );
  });

  it("a poisoned stored record (index entry without fp) is healed, not merged into a throw", async () => {
    const { GA, b } = setup({ turns: [A, B] });
    // e.g. a malformed archive import: mergeTurnLists would throw on {} forever.
    b._data["ga:convo:gemini:c1"] = {
      provider: "gemini",
      id: "c1",
      turns: [{}, { role: "user", fp: fpOf(GA, A.text), order: 0 }],
      blobs: {},
    };

    await GA.convoCapture.capture(); // must not reject

    const rec = bucket(b);
    expect(rec.turns.map((t) => t.fp)).toEqual([A, B].map((t) => fpOf(GA, t.text)));
    expect(rec.turns.every((t) => t.fp && typeof t.fp.hash === "number")).toBe(true);
  });
});

describe("convoCapture.capture — gates", () => {
  it("zero threads -> no-op: no saveConvo, no ga:convo bucket", async () => {
    const { GA, b } = setup({ turns: [A, B], threads: 0 });
    const save = vi.spyOn(GA.store, "saveConvo");

    await GA.convoCapture.capture();

    expect(save).not.toHaveBeenCalled();
    expect(Object.keys(b._data).filter((k) => k.startsWith("ga:convo:"))).toEqual([]);
  });

  it("null session (pre-id draft) -> no-op", async () => {
    const { GA, b } = setup({ turns: [A, B], session: null });
    const save = vi.spyOn(GA.store, "saveConvo");
    const gzip = vi.spyOn(GA.core.compress, "gzipToB64");

    await GA.convoCapture.capture();

    expect(save).not.toHaveBeenCalled();
    expect(gzip).not.toHaveBeenCalled();
    expect(Object.keys(b._data)).toEqual([]);
  });

  it("empty snapshot (nothing hydrated yet) -> writes nothing", async () => {
    const { GA, b } = setup({ turns: [] });
    const save = vi.spyOn(GA.store, "saveConvo");

    await GA.convoCapture.capture();

    expect(save).not.toHaveBeenCalled();
    expect(bucket(b)).toBeUndefined();
  });
});

describe("convoCapture.snapshot — pure reuse of GA.turns", () => {
  it("maps findTurns through textOf/fingerprintOf into {role, text, fp, head, order}", () => {
    const { GA } = setup({ turns: [A, B] });

    const snap = GA.convoCapture.snapshot();

    expect(snap).toEqual([
      { role: "user", text: A.text, fp: fpOf(GA, A.text), head: headOf(GA, A.text), order: 0 },
      { role: "model", text: B.text, fp: fpOf(GA, B.text), head: headOf(GA, B.text), order: 1 },
    ]);
    expect(GA.turns.findTurns).toHaveBeenCalledTimes(1);
    expect(GA.turns.textOf).toHaveBeenCalledTimes(2);
  });

  it("fingerprints the exact captured text — never turns.js's element cache, which can be stale mid-stream", () => {
    const { GA } = setup({ turns: [A] });
    // A stale cache would hand back the fingerprint of some OLD text; the blob
    // key must follow the text actually captured, or the key lies about content.
    GA.turns.fingerprintOf = vi.fn(() => GA.core.turnId.fingerprint("STALE OLD TEXT"));

    const snap = GA.convoCapture.snapshot();

    expect(snap[0].fp).toEqual(fpOf(GA, A.text));
    expect(GA.turns.fingerprintOf).not.toHaveBeenCalled();
  });

  it("skips turns the merge could not key safely: empty text, whitespace-only text, unknown role", () => {
    const { GA } = setup({
      turns: [
        { role: "user", text: "" },
        { role: "model", text: "   \n\t " }, // normalizes to length 0
        A,
        { role: null, text: "mystery" },
        B,
      ],
    });

    const snap = GA.convoCapture.snapshot();

    expect(snap.map((t) => t.text)).toEqual([A.text, B.text]);
    expect(snap.map((t) => t.order)).toEqual([0, 1]); // contiguous after the skip
  });

  it('captures a turn whose entire text is falsy-looking ("0")', () => {
    const { GA } = setup({ turns: [{ role: "user", text: "0" }] });

    const snap = GA.convoCapture.snapshot();

    expect(snap).toHaveLength(1);
    expect(snap[0].text).toBe("0");
  });

  it("does no scraping of its own: no querySelector / DOM reads in the source", () => {
    const src = read("src/content/convo-capture.js").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/querySelector|getElementsBy|createTreeWalker|innerText|textContent/);
    // And no decompression anywhere in the capture path.
    expect(src).not.toMatch(/b64ToText|DecompressionStream|atob/);
  });
});

describe("convoCapture.schedule — debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rapid schedule() calls collapse into ONE capture after the quiet window", async () => {
    const { GA } = setup({ turns: [A, B] });
    const load = vi.spyOn(GA.store, "loadConvo");
    const save = vi.spyOn(GA.store, "saveConvo");

    GA.convoCapture.schedule();
    await vi.advanceTimersByTimeAsync(600);
    GA.convoCapture.schedule(); // resets the window
    GA.convoCapture.schedule();
    await vi.advanceTimersByTimeAsync(1199);
    expect(load).not.toHaveBeenCalled(); // still inside the quiet window

    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(1); // exactly one capture started

    vi.useRealTimers();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1)); // and it completed
  });

  it("a later schedule() after the window fires a fresh capture", async () => {
    const { GA } = setup({ turns: [A, B] });
    const load = vi.spyOn(GA.store, "loadConvo");
    // Captures serialize through a chain; stub the codec so the first capture
    // finishes under fake timers and can't hold the second one back.
    vi.spyOn(GA.core.compress, "gzipToB64").mockResolvedValue("stub-blob");

    GA.convoCapture.schedule();
    await vi.advanceTimersByTimeAsync(1200);
    GA.convoCapture.schedule();
    await vi.advanceTimersByTimeAsync(1200);

    expect(load).toHaveBeenCalledTimes(2);
  });
});

// ---- trigger wiring -------------------------------------------------------

// thread-controller with recording fakes for everything it touches (same
// pattern as thread-controller-restore.test.js), plus a spied convoCapture.
function makeController() {
  const GA = loadGA([
    "src/core/live-stream.js",
    "src/core/session-bindings.js",
    "src/content/thread-controller.js",
  ]);
  GA.warn = vi.fn();
  GA.uid = () => "t1";
  GA.truncate = (s) => s;
  GA.toast = vi.fn();
  GA.config = { REANCHOR_RETRY_MS: [], SECTION_CHARS: 100 };
  GA.store = {
    load: vi.fn(async () => []),
    migrateDraft: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  GA.selection = {
    capture: vi.fn(() => ({ selector: {}, anchor: { role: "model" }, sectionText: "s", range: {} })),
    highlightRange: vi.fn(),
    highlightThread: vi.fn(),
    anchorEl: vi.fn(() => ({})),
    unhighlight: vi.fn(),
    reanchorAll: vi.fn(),
  };
  GA.gutter = {
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    relayout: vi.fn(),
    scheduleLayout: vi.fn(),
    focusThread: vi.fn(),
    get: vi.fn(),
  };
  GA.ThreadBox = vi.fn(() => ({ focusInput: vi.fn() }));
  GA.convoCapture = { capture: vi.fn(async () => {}), schedule: vi.fn() };
  return GA;
}

describe("trigger wiring — thread-controller", () => {
  it("createFromSelection captures IMMEDIATELY (not via the debounce)", async () => {
    const GA = makeController();

    await GA.threadController.createFromSelection();

    expect(GA.convoCapture.capture).toHaveBeenCalledTimes(1);
    expect(GA.convoCapture.schedule).not.toHaveBeenCalled();
  });

  it("restoreForSession schedules a debounced capture (never an immediate one)", async () => {
    const GA = makeController();

    await GA.threadController.restoreForSession("gemini:s1");

    expect(GA.convoCapture.schedule).toHaveBeenCalledTimes(1);
    expect(GA.convoCapture.capture).not.toHaveBeenCalled();
  });

  it("a capture failure is warned about, never thrown into the create flow", async () => {
    const GA = makeController();
    GA.convoCapture.capture = vi.fn(() => Promise.reject(new Error("gzip broke")));

    await GA.threadController.createFromSelection();
    await new Promise((r) => setTimeout(r, 0)); // let the rejection propagate

    expect(GA.warn).toHaveBeenCalled();
  });

  it("both paths survive convoCapture being absent (load-order safety)", async () => {
    const GA = makeController();
    delete GA.convoCapture;

    await GA.threadController.createFromSelection();
    await GA.threadController.restoreForSession("gemini:s1");

    expect(GA.gutter.relayout).toHaveBeenCalled(); // both flows ran to completion
  });
});

describe("trigger wiring — reanchorer settle ping", () => {
  function observeWith(ctx) {
    const GA = loadGA(["src/content/reanchorer.js"]);
    GA.frame = { schedule: (name, fn) => fn() }; // run frames synchronously
    GA.turns = { turnOf: () => null, invalidate: vi.fn() };
    GA.gutter = { onAnchorsMoved: vi.fn() };
    GA.reanchorer.observe(ctx);
    return GA;
  }

  it("every settle frame pings ctx.onSettled (capture debounces on its side)", () => {
    const ctx = { hasOrphans: () => false, reanchor: vi.fn(), onSettled: vi.fn() };
    observeWith(ctx);

    window.dispatchEvent(new Event("scroll"));

    expect(ctx.onSettled).toHaveBeenCalledTimes(1);
  });

  it("pings even when orphans forced a reanchor pass", () => {
    const ctx = { hasOrphans: () => true, reanchor: vi.fn(), onSettled: vi.fn() };
    observeWith(ctx);

    window.dispatchEvent(new Event("scroll"));

    expect(ctx.reanchor).toHaveBeenCalledTimes(1);
    expect(ctx.onSettled).toHaveBeenCalledTimes(1);
  });

  it("a ctx without onSettled keeps working (older callers)", () => {
    const ctx = { hasOrphans: () => false, reanchor: vi.fn() };
    observeWith(ctx);

    expect(() => window.dispatchEvent(new Event("scroll"))).not.toThrow();
  });
});

describe("trigger wiring — content.js seam", () => {
  it("content.js passes onSettled -> GA.convoCapture.schedule into the reanchorer ctx", () => {
    const src = read("src/content/content.js").replace(/\/\/.*$/gm, "");
    const ctxBlock = src.match(/GA\.reanchorer\.observe\(\{([\s\S]*?)\}\)/);
    expect(ctxBlock, "reanchorer.observe ctx not found").toBeTruthy();
    expect(ctxBlock[1]).toMatch(
      /onSettled:\s*\(\)\s*=>\s*GA\.convoCapture\s*&&\s*GA\.convoCapture\.schedule\(\)/
    );
  });
});
