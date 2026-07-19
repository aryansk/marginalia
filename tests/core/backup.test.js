import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const GA = loadGA(["src/shared/settings-schema.js", "src/core/backup.js"]);
const { buildExport, mergeImport, mergeTurnLists } = GA.core.backup;

// ---------- fixtures ----------

// A turn-index entry: {role, fp:{hash,len}, order}
const T = (role, hash, len, order) => ({ role, fp: { hash, len }, order });
const keys = (turns) => turns.map((t) => t.role + ":" + t.fp.hash + ":" + t.fp.len);

// Deep-freeze so any mutation of an input throws in strict-mode test code.
function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  return obj;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

function makeConvo(overrides = {}) {
  return {
    provider: "gemini",
    id: "conv1",
    title: "Talk about bosons",
    url: "https://gemini.google.com/app/conv1",
    capturedAt: 1000,
    turns: [T("user", "h1", 5, 0), T("model", "h2", 9, 1)],
    blobs: { "h1:5": "Zm9vYmFy", "h2:9": "YmF6cXV4" },
    ...overrides,
  };
}

// ---------- mergeTurnLists ----------

describe("GA.core.backup.mergeTurnLists", () => {
  const A = T("user", "a", 3, 0);
  const B = T("model", "b", 4, 1);
  const C = T("user", "c", 5, 2);

  it("PREPEND (scroll-up): snapshot turns before the first shared anchor land first", () => {
    const existing = [T("user", "a", 3, 0), T("model", "b", 4, 1), T("user", "c", 5, 2)];
    const snapshot = [
      T("user", "x", 7, 0),
      T("model", "y", 8, 1),
      T("user", "a", 3, 2),
      T("model", "b", 4, 3),
      T("user", "c", 5, 4),
    ];
    const merged = mergeTurnLists(existing, snapshot);
    expect(keys(merged)).toEqual(["user:x:7", "model:y:8", "user:a:3", "model:b:4", "user:c:5"]);
    expect(merged.map((t) => t.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("APPEND: snapshot turns after the last shared anchor land last", () => {
    const merged = mergeTurnLists([A, B], [T("user", "a", 3, 0), T("model", "b", 4, 1), C]);
    expect(keys(merged)).toEqual(["user:a:3", "model:b:4", "user:c:5"]);
  });

  it("MIDDLE-INSERT: a snapshot-only turn between anchors is inserted between them", () => {
    const merged = mergeTurnLists(
      [A, C],
      [T("user", "a", 3, 0), T("model", "mid", 6, 1), T("user", "c", 5, 2)],
    );
    expect(keys(merged)).toEqual(["user:a:3", "model:mid:6", "user:c:5"]);
  });

  it("between anchors, existing-only entries come before snapshot-only entries", () => {
    const existing = [A, T("model", "e1", 2, 1), C];
    const snapshot = [T("user", "a", 3, 0), T("model", "s1", 9, 1), T("user", "c", 5, 2)];
    const merged = mergeTurnLists(existing, snapshot);
    expect(keys(merged)).toEqual(["user:a:3", "model:e1:2", "model:s1:9", "user:c:5"]);
  });

  it("MULTISET: two identical 'continue' turns both survive; a third in the snapshot appears", () => {
    const cont = () => T("user", "cont", 8, 0);
    const reply = () => T("model", "rep", 6, 0);
    // both sides have [continue, reply, continue] -> stays 3, nothing collapses
    const same = mergeTurnLists([cont(), reply(), cont()], [cont(), reply(), cont()]);
    expect(keys(same)).toEqual(["user:cont:8", "model:rep:6", "user:cont:8"]);
    // snapshot appends a third identical continue -> three survive
    const grown = mergeTurnLists([cont(), reply(), cont()], [cont(), reply(), cont(), cont()]);
    expect(keys(grown)).toEqual(["user:cont:8", "model:rep:6", "user:cont:8", "user:cont:8"]);
  });

  it("role is part of the alignment key: user/model turns with identical fp never align", () => {
    const merged = mergeTurnLists([T("user", "same", 4, 0)], [T("model", "same", 4, 0)]);
    expect(merged).toHaveLength(2);
    expect(keys(merged)).toEqual(["user:same:4", "model:same:4"]);
  });

  it("is idempotent: merging the same snapshot twice equals merging it once", () => {
    const existing = [A, C];
    const snapshot = [T("user", "a", 3, 0), T("model", "mid", 6, 1), T("user", "c", 5, 2)];
    const once = mergeTurnLists(existing, snapshot);
    const twice = mergeTurnLists(once, snapshot);
    expect(twice).toEqual(once);
  });

  it("renumbers order 0..n-1 regardless of input order values", () => {
    const merged = mergeTurnLists(
      [T("user", "a", 3, 17), T("model", "b", 4, 99)],
      [T("user", "a", 3, 0), T("model", "b", 4, 1), T("user", "c", 5, 2)],
    );
    expect(merged.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it("never mutates its inputs", () => {
    const existing = deepFreeze([T("user", "a", 3, 0), T("model", "e1", 2, 1)]);
    const snapshot = deepFreeze([T("user", "a", 3, 0), T("model", "s1", 9, 1)]);
    const before = [clone(existing), clone(snapshot)];
    const merged = mergeTurnLists(existing, snapshot);
    expect(merged).toHaveLength(3);
    expect(clone(existing)).toEqual(before[0]);
    expect(clone(snapshot)).toEqual(before[1]);
  });

  it("handles empty inputs", () => {
    expect(mergeTurnLists([], [])).toEqual([]);
    expect(keys(mergeTurnLists([], [A, B]))).toEqual(["user:a:3", "model:b:4"]);
    expect(keys(mergeTurnLists([A, B], []))).toEqual(["user:a:3", "model:b:4"]);
    expect(mergeTurnLists([A, B], []).map((t) => t.order)).toEqual([0, 1]);
  });
});

// ---------- buildExport ----------

describe("GA.core.backup.buildExport", () => {
  const threadsBucket = [{ id: "t1", messages: [{ role: "user", text: "q" }] }];
  const convo = makeConvo();
  const all = deepFreeze({
    "ga:settings": { openaiApiKey: "sk-SECRET", scope: "section" },
    openaiApiKey: "sk-TOPLEVEL",
    anthropicApiKey: "sk-OTHER",
    "ga:threads:gemini:s1": threadsBucket,
    "ga:convo:gemini:conv1": convo,
    "unrelated:key": { junk: true },
  });

  it("produces the archive envelope with the passed-in exportedAt (no Date.now)", () => {
    const out = buildExport(all, 123456789);
    expect(out.format).toBe("marginalia-threads");
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe(123456789);
  });

  it("includes ga:threads:* arrays and ga:convo:* record objects by allowlist", () => {
    const out = buildExport(all, 1);
    expect(Object.keys(out.threads)).toEqual(["ga:threads:gemini:s1"]);
    expect(Object.keys(out.convos)).toEqual(["ga:convo:gemini:conv1"]);
    expect(out.threads["ga:threads:gemini:s1"]).toEqual(threadsBucket);
  });

  it("excludes settings, top-level *ApiKey keys and unrelated keys", () => {
    const out = buildExport(all, 1);
    const dumped = JSON.stringify(out);
    expect(dumped).not.toContain("sk-TOPLEVEL");
    expect(dumped).not.toContain("sk-OTHER");
    expect(dumped).not.toContain("sk-SECRET");
    expect(dumped).not.toContain("unrelated:key");
  });

  it("carries convo records verbatim — inner blobs byte-identical, never decompressed", () => {
    const out = buildExport(all, 1);
    const rec = out.convos["ga:convo:gemini:conv1"];
    expect(rec.blobs["h1:5"]).toBe(convo.blobs["h1:5"]);
    expect(rec.blobs["h2:9"]).toBe(convo.blobs["h2:9"]);
    expect(rec.turns).toEqual(convo.turns);
    expect(rec.title).toBe(convo.title);
  });

  it("tolerates an empty storage object", () => {
    const out = buildExport({}, 5);
    expect(out.threads).toEqual({});
    expect(out.convos).toEqual({});
  });
});

// ---------- mergeImport: envelope validation ----------

describe("GA.core.backup.mergeImport — envelope validation", () => {
  const ok = { format: "marginalia-threads", version: 1, exportedAt: 1, threads: {}, convos: {} };

  it("rejects a version newer than this build supports", () => {
    expect(() => mergeImport({}, { ...ok, version: 2 })).toThrow();
  });

  it("rejects a bad or missing format", () => {
    expect(() => mergeImport({}, { ...ok, format: "something-else" })).toThrow();
    expect(() => mergeImport({}, { version: 1 })).toThrow();
    expect(() => mergeImport({}, null)).toThrow();
  });

  it("rejects a non-numeric version", () => {
    expect(() => mergeImport({}, { ...ok, version: "1" })).toThrow();
  });

  it("rejects a NaN version", () => {
    // Siege finding 3: NaN is typeof "number" and NaN > 1 is false.
    expect(() => mergeImport({}, { ...ok, version: NaN })).toThrow();
  });

  it("never persists garbage buckets from a hand-crafted archive", () => {
    // Siege finding 2: archives are arbitrary user JSON; a bucket with the
    // wrong shape is skipped, never written over (or alongside) real data.
    const existing = deepFreeze({
      "ga:threads:g:s1": [{ id: "keep", messages: [] }],
      "ga:convo:g:c1": makeConvo(),
    });
    const junk = {
      format: "marginalia-threads",
      version: 1,
      threads: { "ga:threads:g:s1": { not: "an array" }, "ga:threads:g:new": "junk" },
      convos: { "ga:convo:g:c1": null, "ga:convo:g:new": "junk" },
    };
    for (const mode of ["merge", "replace"]) {
      const next = mergeImport(existing, junk, { mode });
      expect(next["ga:threads:g:s1"]).toEqual(existing["ga:threads:g:s1"]);
      expect(next["ga:convo:g:c1"]).toEqual(existing["ga:convo:g:c1"]);
      expect("ga:threads:g:new" in next).toBe(false);
      expect("ga:convo:g:new" in next).toBe(false);
    }
  });

  it("tolerates a missing convos section", () => {
    const archive = { format: "marginalia-threads", version: 1, threads: { "ga:threads:g:s": [] } };
    expect(() => mergeImport({}, archive)).not.toThrow();
  });

  it("tolerates a missing threads section", () => {
    const archive = { format: "marginalia-threads", version: 1, convos: {} };
    expect(() => mergeImport({}, archive)).not.toThrow();
  });
});

// ---------- mergeImport: merge mode, threads ----------

describe("GA.core.backup.mergeImport — merge mode, thread buckets", () => {
  const K = "ga:threads:gemini:s1";
  const archiveWith = (bucket) => ({
    format: "marginalia-threads",
    version: 1,
    threads: { [K]: bucket },
    convos: {},
  });

  it("a thread only in existing survives (archive can never delete)", () => {
    const localOnly = { id: "keep-me", messages: [{ role: "user", text: "hi" }] };
    const existing = deepFreeze({ [K]: [localOnly] });
    const next = mergeImport(existing, archiveWith([{ id: "other", messages: [] }]));
    const ids = next[K].map((t) => t.id);
    expect(ids).toContain("keep-me");
    expect(ids).toContain("other");
  });

  it("a local bucket absent from the archive is untouched", () => {
    const existing = deepFreeze({ "ga:threads:gemini:elsewhere": [{ id: "x", messages: [] }] });
    const next = mergeImport(existing, archiveWith([]));
    expect(next["ga:threads:gemini:elsewhere"]).toEqual(existing["ga:threads:gemini:elsewhere"]);
  });

  it("id collision keeps the record with more messages (content-max)", () => {
    const short = { id: "t1", messages: [{ role: "user", text: "q" }] };
    const long = {
      id: "t1",
      messages: [
        { role: "user", text: "q" },
        { role: "model", text: "a" },
      ],
    };
    // archive longer -> archive record's content wins
    const a = mergeImport(deepFreeze({ [K]: [short] }), archiveWith([long]));
    expect(a[K]).toHaveLength(1);
    expect(a[K][0].messages).toHaveLength(2);
    // archive shorter -> local kept
    const b = mergeImport(deepFreeze({ [K]: [long] }), archiveWith([short]));
    expect(b[K]).toHaveLength(1);
    expect(b[K][0].messages).toHaveLength(2);
  });

  it("a TIE keeps the existing record verbatim", () => {
    const local = { id: "t1", messages: [{ role: "user", text: "local words" }], resolved: true };
    const imported = { id: "t1", messages: [{ role: "user", text: "archive words" }] };
    const next = mergeImport({ [K]: [local] }, archiveWith([imported]));
    expect(next[K]).toHaveLength(1);
    expect(next[K][0]).toBe(local);
  });

  it("F8: when the archive record wins, local resolved/resolvedAt/collapsed/unread survive", () => {
    const local = {
      id: "t1",
      messages: [{ role: "user", text: "q" }],
      resolved: true,
      resolvedAt: 777,
      collapsed: true,
      unread: false,
    };
    const archived = {
      id: "t1",
      messages: [
        { role: "user", text: "q" },
        { role: "model", text: "a" },
      ],
      resolved: false,
      unread: true,
    };
    const next = mergeImport(deepFreeze({ [K]: [local] }), archiveWith([archived]));
    const merged = next[K][0];
    expect(merged.messages).toHaveLength(2); // archive content won
    expect(merged.resolved).toBe(true); // ...but local status flags survive
    expect(merged.resolvedAt).toBe(777);
    expect(merged.collapsed).toBe(true);
    expect(merged.unread).toBe(false);
  });

  it("archive-win preserves EVERY local field — selector/anchor/section/createdAt, not just flags", () => {
    // Siege finding 1: a restore recovers messages; it must never relocate a
    // working highlight or re-stamp the TTL clock on the way through.
    const local = {
      id: "t1",
      messages: [{ role: "user", text: "q" }],
      selector: { exact: "LOCAL re-highlighted phrase" },
      anchor: { turnId: "turn-LOCAL" },
      section: "local section context",
      createdAt: 1111,
      resolved: true,
    };
    const archived = {
      id: "t1",
      messages: [
        { role: "user", text: "q" },
        { role: "model", text: "a" },
      ],
      selector: { exact: "ARCHIVE stale phrase" },
      anchor: { turnId: "turn-ARCHIVE" },
      section: "archive section context",
      createdAt: 9999,
      resolved: false,
      exportOnly: "archive-only field",
    };
    const next = mergeImport(deepFreeze({ [K]: [local] }), archiveWith([archived]));
    const merged = next[K][0];
    expect(merged.messages).toHaveLength(2); // archive content wins...
    expect(merged.selector).toEqual({ exact: "LOCAL re-highlighted phrase" });
    expect(merged.anchor).toEqual({ turnId: "turn-LOCAL" });
    expect(merged.section).toBe("local section context");
    expect(merged.createdAt).toBe(1111);
    expect(merged.resolved).toBe(true);
    expect(merged.exportOnly).toBe("archive-only field"); // fields only the archive has still arrive
  });

  it("F8 copies only flags actually present on the local record", () => {
    const local = { id: "t1", messages: [] }; // no flags at all
    const archived = { id: "t1", messages: [{ role: "user", text: "q" }], resolved: false };
    const next = mergeImport({ [K]: [local] }, archiveWith([archived]));
    const merged = next[K][0];
    expect(merged.resolved).toBe(false); // archive's own value, not fabricated
    expect("resolvedAt" in merged).toBe(false);
    expect("collapsed" in merged).toBe(false);
  });
});

// ---------- mergeImport: merge mode, convos ----------

describe("GA.core.backup.mergeImport — merge mode, convo buckets", () => {
  const K = "ga:convo:gemini:conv1";
  const archiveWith = (rec, extra = {}) => ({
    format: "marginalia-threads",
    version: 1,
    threads: {},
    convos: { [K]: rec, ...extra },
  });

  it("interleaves turns via mergeTurnLists and unions blobs by '<hash>:<len>' key", () => {
    const local = makeConvo({
      turns: [T("user", "a", 3, 0), T("model", "b", 4, 1)],
      blobs: { "a:3": "AAA", "b:4": "BBB" },
    });
    const imported = makeConvo({
      turns: [
        T("user", "x", 7, 0), // scroll-up reveal: older turn first
        T("user", "a", 3, 1),
        T("model", "b", 4, 2),
      ],
      blobs: { "x:7": "XXX", "a:3": "AAA", "b:4": "BBB" },
    });
    const next = mergeImport(deepFreeze({ [K]: local }), archiveWith(imported));
    const merged = next[K];
    expect(keys(merged.turns)).toEqual(["user:x:7", "user:a:3", "model:b:4"]);
    expect(merged.turns.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(merged.blobs).toEqual({ "a:3": "AAA", "b:4": "BBB", "x:7": "XXX" });
  });

  it("identical blob keys dedupe with existing winning on conflict", () => {
    const local = makeConvo({ blobs: { "h1:5": "LOCAL" } });
    const imported = makeConvo({ blobs: { "h1:5": "ARCHIVE", "h9:2": "NEW" } });
    const next = mergeImport({ [K]: local }, archiveWith(imported));
    expect(next[K].blobs["h1:5"]).toBe("LOCAL");
    expect(next[K].blobs["h9:2"]).toBe("NEW");
  });

  it("metadata (title/url/capturedAt) comes from the newer capturedAt", () => {
    const local = makeConvo({ capturedAt: 1000, title: "Old title", url: "https://old" });
    const importedNewer = makeConvo({ capturedAt: 2000, title: "New title", url: "https://new" });
    const a = mergeImport({ [K]: local }, archiveWith(importedNewer));
    expect(a[K].title).toBe("New title");
    expect(a[K].url).toBe("https://new");
    expect(a[K].capturedAt).toBe(2000);
    const importedOlder = makeConvo({ capturedAt: 500, title: "Stale", url: "https://stale" });
    const b = mergeImport({ [K]: local }, archiveWith(importedOlder));
    expect(b[K].title).toBe("Old title");
    expect(b[K].capturedAt).toBe(1000);
  });

  it("a convo present on only one side is carried whole", () => {
    const localOnly = makeConvo({ id: "mine" });
    const importedOnly = makeConvo({ id: "theirs" });
    const existing = deepFreeze({ "ga:convo:gemini:mine": localOnly });
    const next = mergeImport(
      existing,
      archiveWith(importedOnly, {}), // K = ga:convo:gemini:conv1 holds importedOnly
    );
    expect(next["ga:convo:gemini:mine"]).toBe(localOnly);
    expect(next[K]).toBe(importedOnly);
  });

  it("blobs pass through untouched — same string references, never decompressed", () => {
    const local = makeConvo();
    const imported = makeConvo({ blobs: { "zz:1": "R0lGODlh" } });
    const next = mergeImport({ [K]: local }, archiveWith(imported));
    expect(next[K].blobs["h1:5"]).toBe(local.blobs["h1:5"]);
    expect(next[K].blobs["zz:1"]).toBe(imported.blobs["zz:1"]);
  });
});

// ---------- mergeImport: idempotency + round-trip ----------

describe("GA.core.backup.mergeImport — idempotency and round-trip", () => {
  const all = {
    "ga:settings": { openaiApiKey: "sk-SECRET" },
    "ga:threads:gemini:s1": [
      { id: "t1", messages: [{ role: "user", text: "q" }], resolved: true },
      { id: "t2", messages: [] },
    ],
    "ga:convo:gemini:conv1": makeConvo(),
  };

  it("round-trip: export then merge-import into empty reproduces threads AND convos", () => {
    const archive = buildExport(all, 42);
    const restored = mergeImport({}, archive, { mode: "merge" });
    expect(restored["ga:threads:gemini:s1"]).toEqual(all["ga:threads:gemini:s1"]);
    expect(restored["ga:convo:gemini:conv1"].blobs).toEqual(all["ga:convo:gemini:conv1"].blobs);
    expect(keys(restored["ga:convo:gemini:conv1"].turns)).toEqual(
      keys(all["ga:convo:gemini:conv1"].turns),
    );
    expect(restored["ga:settings"]).toBeUndefined();
  });

  it("importing the same archive twice equals importing it once (no growth)", () => {
    const archive = buildExport(all, 42);
    const existing = {
      "ga:threads:gemini:s1": [{ id: "t3", messages: [{ role: "user", text: "local" }] }],
      "ga:convo:gemini:conv1": makeConvo({
        turns: [T("user", "h1", 5, 0)],
        blobs: { "h1:5": "Zm9vYmFy" },
      }),
    };
    const once = mergeImport(existing, archive);
    const twice = mergeImport(once, archive);
    expect(twice).toEqual(once);
    expect(twice["ga:threads:gemini:s1"]).toHaveLength(3);
    expect(twice["ga:convo:gemini:conv1"].turns).toHaveLength(2);
  });

  it("never mutates existing or the archive", () => {
    const archive = deepFreeze(buildExport(clone(all), 42));
    const existing = deepFreeze({
      "ga:threads:gemini:s1": [{ id: "tX", messages: [] }],
    });
    const beforeExisting = clone(existing);
    const beforeArchive = clone(archive);
    mergeImport(existing, archive);
    expect(clone(existing)).toEqual(beforeExisting);
    expect(clone(archive)).toEqual(beforeArchive);
  });
});

// ---------- mergeImport: replace mode ----------

describe("GA.core.backup.mergeImport — replace mode", () => {
  it("overwrites archive-named buckets wholesale and leaves unrelated buckets intact", () => {
    const existing = deepFreeze({
      "ga:threads:gemini:s1": [{ id: "old", messages: [{ role: "user", text: "gone" }] }],
      "ga:threads:gemini:s2": [{ id: "safe", messages: [] }],
      "ga:convo:gemini:conv1": makeConvo({ title: "old convo" }),
      "ga:settings": { scope: "section" },
    });
    const archive = {
      format: "marginalia-threads",
      version: 1,
      threads: { "ga:threads:gemini:s1": [{ id: "new", messages: [] }] },
      convos: { "ga:convo:gemini:conv1": makeConvo({ title: "new convo" }) },
    };
    const next = mergeImport(existing, archive, { mode: "replace" });
    expect(next["ga:threads:gemini:s1"].map((t) => t.id)).toEqual(["new"]);
    expect(next["ga:threads:gemini:s2"]).toEqual(existing["ga:threads:gemini:s2"]);
    expect(next["ga:convo:gemini:conv1"].title).toBe("new convo");
    expect(next["ga:settings"]).toEqual({ scope: "section" });
  });
});

// ---------- mergeImport: bucket keys must carry the right prefix ----------

describe("GA.core.backup.mergeImport — key-prefix guard (crafted archive)", () => {
  // Archive maps are user-supplied JSON: a key that doesn't carry the matching
  // prefix (e.g. "ga:settings" smuggled into `threads` as an array, which
  // passes the shape check) must be skipped in BOTH modes, or an import could
  // clobber the settings/API-key record.
  const existing = deepFreeze({
    "ga:settings": { openaiApiKey: "sk-SECRET", scope: "section" },
    "ga:threads:gemini:s1": [{ id: "keep", messages: [] }],
  });
  const crafted = {
    format: "marginalia-threads",
    version: 1,
    threads: {
      "ga:settings": [{ id: "evil", messages: [{ role: "user", text: "x" }] }],
      "ga:convo:gemini:conv1": [{ id: "misfiled", messages: [] }],
      "unrelated-key": [{ id: "junk", messages: [] }],
      "ga:threads:gemini:s2": [{ id: "legit", messages: [] }],
    },
    convos: {
      "ga:settings": makeConvo(),
      "ga:threads:gemini:s1": makeConvo(),
      "ga:convo:gemini:conv9": makeConvo({ id: "conv9" }),
    },
  };

  for (const mode of ["merge", "replace"]) {
    it(`${mode} mode: writes only correctly-prefixed buckets, never the settings key`, () => {
      const next = mergeImport(existing, clone(crafted), { mode });
      expect(next["ga:settings"]).toEqual(existing["ga:settings"]);
      expect(next["unrelated-key"]).toBeUndefined();
      expect(next["ga:threads:gemini:s2"].map((t) => t.id)).toEqual(["legit"]);
      expect(next["ga:convo:gemini:conv9"].id).toBe("conv9");
      // The misfiled cross-prefix entries must not arrive through the wrong map.
      expect(next["ga:convo:gemini:conv1"]).toBeUndefined();
      expect(next["ga:threads:gemini:s1"]).toEqual(existing["ga:threads:gemini:s1"]);
    });
  }
});

// ---------- merge: hostile record ids from Object.prototype ----------

describe("GA.core.backup.mergeImport — prototype-name record ids", () => {
  it('an archive record with id "__proto__" appends cleanly instead of corrupting the bucket', () => {
    const existing = { "ga:threads:gemini:s1": [{ id: "normal", messages: [] }] };
    const archive = {
      format: "marginalia-threads",
      version: 1,
      threads: {
        "ga:threads:gemini:s1": [
          { id: "__proto__", messages: [{ role: "user", text: "q" }] },
          { id: "toString", messages: [] },
        ],
      },
      convos: {},
    };
    const next = mergeImport(existing, archive, { mode: "merge" });
    const bucket = next["ga:threads:gemini:s1"];
    expect(Array.isArray(bucket)).toBe(true);
    expect(bucket.map((t) => t.id)).toEqual(["normal", "__proto__", "toString"]);
    // No junk expando keys written onto the array itself.
    expect(Object.keys(bucket)).toEqual(["0", "1", "2"]);
    // Idempotent for these ids too.
    const again = mergeImport(next, archive, { mode: "merge" });
    expect(again["ga:threads:gemini:s1"]).toHaveLength(3);
  });
});

// ---------- purity of the module source ----------

describe("src/core/backup.js purity", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/core/backup.js"), "utf8");

  it("never touches time, the browser, the DOM, compression, or async APIs", () => {
    expect(src).not.toMatch(/Date\.now/);
    expect(src).not.toMatch(/\bbrowser\./);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/CompressionStream|DecompressionStream|b64ToText|atob|btoa/);
    expect(src).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
  });

  it("ends with the module.exports shim", () => {
    expect(src).toMatch(/if \(typeof module !== "undefined" && module\.exports\)/);
  });
});
