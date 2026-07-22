import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Shared in-memory browser.storage.local fake (clone semantics — the store's
// in-place createdAt stamping can't silently rewrite what "storage" holds).
const fakeBrowser = () => makeStorageFake().browser;

let GA;
beforeEach(() => {
  GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], {
    browser: fakeBrowser(),
  });
});

const thread = (id) => ({ id, selector: { exact: id }, messages: [] });

describe("store", () => {
  it("upserts a new thread, then reads it back", async () => {
    await GA.store.upsert("s1", thread("a"));
    expect(await GA.store.load("s1")).toHaveLength(1);
  });

  it("upsert replaces an existing thread with the same id", async () => {
    await GA.store.upsert("s1", thread("a"));
    await GA.store.upsert("s1", { id: "a", selector: { exact: "changed" }, messages: [] });
    const all = await GA.store.load("s1");
    expect(all).toHaveLength(1);
    expect(all[0].selector.exact).toBe("changed");
  });

  it("removes a thread", async () => {
    await GA.store.upsert("s1", thread("a"));
    await GA.store.remove("s1", "a");
    expect(await GA.store.load("s1")).toEqual([]);
  });

  it("keeps sessions isolated (no cross-conversation bleed)", async () => {
    await GA.store.upsert("s1", thread("a"));
    expect(await GA.store.load("s2")).toEqual([]);
    await GA.store.upsert("s2", thread("b"));
    expect((await GA.store.load("s1")).map((t) => t.id)).toEqual(["a"]);
    expect((await GA.store.load("s2")).map((t) => t.id)).toEqual(["b"]);
  });

  it("migrateDraft moves draft threads into the session and clears the draft", async () => {
    await GA.store.upsert(null, thread("draft1")); // null -> draft bucket
    await GA.store.migrateDraft("s1");
    expect((await GA.store.load("s1")).map((t) => t.id)).toEqual(["draft1"]);
    expect(await GA.store.load(null)).toEqual([]);
  });

  it("migrateDraft de-dupes by thread id (rebound persist already wrote it)", async () => {
    await GA.store.upsert(null, thread("a"));
    await GA.store.upsert("s1", thread("a")); // same thread already in the target
    await GA.store.upsert(null, thread("b"));
    await GA.store.migrateDraft("s1");
    expect((await GA.store.load("s1")).map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("draft buckets are isolated per tab (no cross-tab theft)", async () => {
    const b = fakeBrowser();
    const tab = (token) => {
      const g = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser: b });
      g.provider = "gemini";
      g.tabToken = token;
      return g.store;
    };
    const tab1 = tab("tab_1");
    const tab2 = tab("tab_2");
    await tab1.upsert(null, thread("mine"));
    await tab2.upsert(null, thread("yours"));
    // tab1's chat gets an id: only tab1's draft moves
    await tab1.migrateDraft("gemini:abc");
    expect((await tab1.load("gemini:abc")).map((t) => t.id)).toEqual(["mine"]);
    expect((await tab2.load(null)).map((t) => t.id)).toEqual(["yours"]); // untouched
  });

  it("serializes concurrent writers (no lost updates)", async () => {
    // A storage whose `get` resolves one tick late: without serialization both
    // upserts read the same (empty) array and the second save drops the first.
    const b = fakeBrowser();
    const realGet = b.storage.local.get;
    b.storage.local.get = async (k) => {
      await new Promise((r) => setTimeout(r, 0));
      return realGet(k);
    };
    GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser: b });
    await Promise.all([GA.store.upsert("s1", thread("a")), GA.store.upsert("s1", thread("b"))]);
    expect((await GA.store.load("s1")).map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("concurrent upsert and remove both take effect", async () => {
    await GA.store.upsert("s1", thread("a"));
    await Promise.all([GA.store.upsert("s1", thread("b")), GA.store.remove("s1", "a")]);
    expect((await GA.store.load("s1")).map((t) => t.id)).toEqual(["b"]);
  });

  it("a failing op does not poison the queue", async () => {
    const b = fakeBrowser();
    GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser: b });
    const realSet = b.storage.local.set;
    b.storage.local.set = async () => {
      throw new Error("quota");
    };
    await expect(GA.store.upsert("s1", thread("a"))).rejects.toThrow("quota");
    b.storage.local.set = realSet;
    await GA.store.upsert("s1", thread("b"));
    expect((await GA.store.load("s1")).map((t) => t.id)).toEqual(["b"]);
  });

  it("clearAll removes only ga:threads:* keys", async () => {
    const b = fakeBrowser();
    GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser: b });
    b._data["ga:settings"] = { scope: "section" }; // unrelated key
    await GA.store.upsert("s1", thread("a"));
    await GA.store.clearAll();
    expect(Object.keys(b._data)).toEqual(["ga:settings"]);
  });
});

describe("draft housekeeping", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 100 * DAY;
  const aged = (id, at) => ({ id, selector: { exact: id }, messages: [], createdAt: at });

  function storeFor(browser, token) {
    const g = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser });
    g.provider = "gemini";
    g.tabToken = token;
    return g.store;
  }

  it("sweepDrafts adopts a legacy (pre-tab-token) bucket for this provider", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini"] = [aged("legacy1", NOW - DAY)]; // old key shape
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect((await store.load(null)).map((t) => t.id)).toEqual(["legacy1"]);
    expect(b._data["ga:threads:__draft__:gemini"]).toBeUndefined();
  });

  it("sweepDrafts adopts (never deletes) a non-empty bucket older than the TTL", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_dead"] = [aged("old", NOW - 30 * DAY)];
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect((await store.load(null)).map((t) => t.id)).toEqual(["old"]); // adopted, not lost
    expect(b._data["ga:threads:__draft__:gemini:tab_dead"]).toBeUndefined(); // source gone
  });

  it("sweepDrafts adopts this provider's buckets, leaves other providers and sessions alone", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_dead"] = [aged("old", NOW - 30 * DAY)];
    b._data["ga:threads:__draft__:gemini:tab_live"] = [aged("fresh", NOW - DAY)];
    b._data["ga:threads:__draft__:claude"] = [aged("other-provider", NOW - DAY)];
    b._data["ga:threads:__draft__:claude:tab_z"] = [aged("other-provider-tab", NOW - DAY)];
    b._data["ga:threads:gemini:real"] = [aged("real", NOW - 30 * DAY)]; // sessions never swept
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect((await store.load(null)).map((t) => t.id).sort()).toEqual(["fresh", "old"]);
    expect(b._data["ga:threads:__draft__:gemini:tab_dead"]).toBeUndefined();
    expect(b._data["ga:threads:__draft__:gemini:tab_live"]).toBeUndefined(); // adopted, key removed
    expect(b._data["ga:threads:__draft__:claude"]).toBeDefined(); // another provider's legacy
    expect(b._data["ga:threads:__draft__:claude:tab_z"]).toBeDefined();
    expect(b._data["ga:threads:gemini:real"]).toBeDefined();
  });

  it("sweepDrafts removes only EMPTY buckets, and only for this provider", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_x"] = [];
    b._data["ga:threads:__draft__:claude:tab_y"] = []; // other provider: untouched even when empty
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect(b._data["ga:threads:__draft__:gemini:tab_x"]).toBeUndefined();
    expect(b._data["ga:threads:__draft__:claude:tab_y"]).toBeDefined();
    expect(await store.load(null)).toEqual([]); // nothing spuriously adopted
  });

  it("sweepDrafts adopts a different-tab bucket, unioning by id with de-dupe", async () => {
    const b = fakeBrowser();
    const store = storeFor(b, "tab_1");
    await store.upsert(null, aged("a", NOW - DAY)); // already in this tab's bucket
    b._data["ga:threads:__draft__:gemini:tab_other"] = [aged("a", NOW - DAY), aged("b", NOW - DAY)];
    b._data["ga:threads:__draft__:gemini:tab_third"] = [aged("b", NOW - DAY), aged("c", NOW - DAY)];
    await store.sweepDrafts(NOW);
    expect((await store.load(null)).map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    expect(b._data["ga:threads:__draft__:gemini:tab_other"]).toBeUndefined();
    expect(b._data["ga:threads:__draft__:gemini:tab_third"]).toBeUndefined();
  });

  it("sweepDrafts keeps a bucket whose threads lack createdAt (undatable -> adopt, not drop)", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_old"] = [
      { id: "undated", selector: { exact: "u" }, messages: [] },
    ];
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    const mine = await store.load(null);
    expect(mine.map((t) => t.id)).toEqual(["undated"]);
    expect(typeof mine[0].createdAt).toBe("number"); // stamped on the adoption write
  });

  it("GUARD: no sweep ever deletes a thread from any non-empty bucket", async () => {
    const b = fakeBrowser();
    const seededIds = ["own", "legacy", "othertab", "ancient", "undated", "foreign", "real"];
    b._data["ga:threads:__draft__:gemini"] = [aged("legacy", NOW - 20 * DAY)];
    b._data["ga:threads:__draft__:gemini:tab_a"] = [aged("othertab", NOW - DAY)];
    b._data["ga:threads:__draft__:gemini:tab_b"] = [aged("ancient", NOW - 365 * DAY)];
    b._data["ga:threads:__draft__:gemini:tab_c"] = [{ id: "undated" }];
    b._data["ga:threads:__draft__:claude:tab_d"] = [aged("foreign", NOW - 365 * DAY)];
    b._data["ga:threads:gemini:real"] = [aged("real", NOW - 365 * DAY)];
    const store = storeFor(b, "tab_1");
    await store.upsert(null, aged("own", NOW - DAY));
    await store.sweepDrafts(NOW);
    const survivors = new Set(
      Object.keys(b._data)
        .filter((k) => k.indexOf("ga:threads:") === 0)
        .flatMap((k) => b._data[k].map((t) => t.id)),
    );
    seededIds.forEach((id) => expect(survivors.has(id)).toBe(true));
  });

  it("upsert stamps a numeric createdAt on threads that lack one", async () => {
    await GA.store.upsert("s1", { id: "nostamp", selector: { exact: "x" }, messages: [] });
    await GA.store.upsert("s1", aged("stamped", 12345));
    const all = await GA.store.load("s1");
    expect(typeof all.find((t) => t.id === "nostamp").createdAt).toBe("number");
    expect(all.find((t) => t.id === "stamped").createdAt).toBe(12345); // existing stamp untouched
  });

  it("sweepDrafts leaves a non-array (corrupt) bucket untouched — never classified empty", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_g"] = { not: "an array" };
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect(b._data["ga:threads:__draft__:gemini:tab_g"]).toEqual({ not: "an array" });
    expect(await store.load(null)).toEqual([]);
  });

  it("sweepDrafts adopts distinct id-less threads without collapsing them", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_p"] = [{ selector: { exact: "p" }, messages: [] }];
    b._data["ga:threads:__draft__:gemini:tab_q"] = [{ selector: { exact: "q" }, messages: [] }];
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    const mine = await store.load(null);
    expect(mine.map((t) => t.selector.exact).sort()).toEqual(["p", "q"]);
  });

  it("a null element in a stored bucket is shed, not allowed to wedge promotion", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_1"] = [null, aged("ok", NOW - DAY)];
    const store = storeFor(b, "tab_1");
    await store.migrateDraft("gemini:abc");
    expect((await store.load("gemini:abc")).map((t) => t.id)).toEqual(["ok"]);
    expect(b._data["ga:threads:__draft__:gemini:tab_1"]).toBeUndefined();
  });
});

describe("draft retention under concurrency (Siege findings)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 100 * DAY;
  const aged = (id, at) => ({ id, selector: { exact: id }, messages: [], createdAt: at });

  function storeFor(browser, token) {
    const g = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser });
    g.provider = "gemini";
    g.tabToken = token;
    return g.store;
  }

  it("sweep does not remove a source bucket that changed mid-sweep (no TOCTOU loss)", async () => {
    const b = fakeBrowser();
    const LIVE = "ga:threads:__draft__:gemini:tab_live";
    b._data[LIVE] = [aged("t1", NOW - DAY)];
    const store = storeFor(b, "tab_1");
    const realGet = b.storage.local.get;
    let injected = false;
    b.storage.local.get = async (k) => {
      const out = await realGet(k);
      if (k == null && !injected) {
        injected = true; // the "live tab" writes t2 right after the sweep snapshots
        b._data[LIVE] = b._data[LIVE].concat([aged("t2", NOW)]);
      }
      return out;
    };
    await store.sweepDrafts(NOW);
    expect((await store.load(null)).map((t) => t.id)).toEqual(["t1"]); // snapshot adopted
    expect(b._data[LIVE].map((t) => t.id)).toEqual(["t1", "t2"]); // changed source kept — t2 safe
  });

  it("migrateDraft keeps a draft written into a shared bucket mid-migration", async () => {
    const b = fakeBrowser();
    const SHARED = "ga:threads:__draft__:gemini:tab_shared";
    const store = storeFor(b, "tab_shared");
    await store.upsert(null, aged("t1", NOW - DAY));
    const realGet = b.storage.local.get;
    let injected = false;
    b.storage.local.get = async (k) => {
      const out = await realGet(k);
      if (k === SHARED && !injected) {
        injected = true; // the other context sharing the token writes t2 mid-migration
        b._data[SHARED] = b._data[SHARED].concat([aged("t2", NOW)]);
      }
      return out;
    };
    await store.migrateDraft("gemini:abc");
    expect((await store.load("gemini:abc")).map((t) => t.id)).toEqual(["t1"]);
    expect(b._data[SHARED].map((t) => t.id)).toEqual(["t2"]); // NOT blind-removed
  });

  it("two tabs sweeping concurrently lose no threads (mutual-adoption annihilation)", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_A"] = [aged("a", NOW - DAY)];
    b._data["ga:threads:__draft__:gemini:tab_B"] = [aged("b", NOW - DAY)];
    // Slow reads widen the interleaving window, as in the serializer tests.
    const realGet = b.storage.local.get;
    b.storage.local.get = async (k) => {
      await new Promise((r) => setTimeout(r, 0));
      return realGet(k);
    };
    const tabA = storeFor(b, "tab_A");
    const tabB = storeFor(b, "tab_B");
    await Promise.all([tabA.sweepDrafts(NOW), tabB.sweepDrafts(NOW)]);
    const survivors = new Set(
      Object.keys(b._data)
        .filter((k) => k.indexOf("ga:threads:") === 0)
        .flatMap((k) => b._data[k].map((t) => t.id)),
    );
    expect(survivors.has("a")).toBe(true);
    expect(survivors.has("b")).toBe(true);
  });
});

describe("conversation transcripts (ga:convo:*)", () => {
  const FILES = ["src/shared/settings-schema.js", "src/core/backup.js", "src/content/store.js"];
  // A turn-index entry and its blob key — fp.hash + ":" + fp.len, BOTH parts.
  const T = (role, hash, len, order) => ({ role, fp: { hash, len }, order });
  const blobKey = (t) => t.fp.hash + ":" + t.fp.len;

  function convoRecord() {
    const turns = [T("user", "h1", 5, 0), T("model", "h2", 42, 1)];
    return {
      provider: "gemini",
      id: "abc",
      title: "A chat",
      url: "https://gemini.google.com/app/abc",
      capturedAt: 123,
      turns,
      blobs: {
        [blobKey(turns[0])]: "H4sIfakegzipblob0",
        [blobKey(turns[1])]: "H4sIfakegzipblob1",
      },
    };
  }

  let b;
  beforeEach(() => {
    b = fakeBrowser();
    GA = loadGA(FILES, { browser: b });
  });

  it("GA.schema.CONVO_PREFIX is the convo bucket prefix", () => {
    expect(GA.schema.CONVO_PREFIX).toBe("ga:convo:");
  });

  it("convoKey namespaces the session under ga:convo:", () => {
    expect(GA.store.convoKey("gemini:abc")).toBe("ga:convo:gemini:abc");
  });

  it("saveConvo/loadConvo round-trip a record verbatim", async () => {
    const rec = convoRecord();
    await GA.store.saveConvo("gemini:abc", rec);
    const loaded = await GA.store.loadConvo("gemini:abc");
    expect(loaded).toEqual(rec);
    expect(b._data["ga:convo:gemini:abc"]).toEqual(rec); // stored under the convo key
  });

  it("blobs come back as the SAME compressed strings — the store never (de)compresses", async () => {
    const rec = convoRecord();
    await GA.store.saveConvo("gemini:abc", rec);
    const loaded = await GA.store.loadConvo("gemini:abc");
    expect(loaded.blobs["h1:5"]).toBe("H4sIfakegzipblob0");
    expect(loaded.blobs["h2:42"]).toBe("H4sIfakegzipblob1");
    expect(Object.keys(loaded.blobs).sort()).toEqual(["h1:5", "h2:42"]);
  });

  it("loadConvo returns null for an unknown session", async () => {
    expect(await GA.store.loadConvo("gemini:nope")).toBeNull();
  });

  it("falsy session: loadConvo -> null, saveConvo -> no-op (drafts get no convo bucket)", async () => {
    expect(await GA.store.loadConvo(null)).toBeNull();
    expect(await GA.store.loadConvo("")).toBeNull();
    await GA.store.saveConvo(null, convoRecord());
    await GA.store.saveConvo("", convoRecord());
    expect(Object.keys(b._data)).toEqual([]); // nothing written
  });

  it("convo records live beside threads without collisions and survive clearAll", async () => {
    await GA.store.upsert("gemini:abc", { id: "t1", selector: { exact: "x" }, messages: [] });
    await GA.store.saveConvo("gemini:abc", convoRecord());
    await GA.store.clearAll(); // clears ga:threads:* only
    expect(Object.keys(b._data)).toEqual(["ga:convo:gemini:abc"]);
  });

  it("saveConvo goes through the serialize() queue (ordered with thread writes)", async () => {
    const calls = [];
    const realSet = b.storage.local.set;
    b.storage.local.set = async (obj) => {
      await new Promise((r) => setTimeout(r, 0)); // widen the interleaving window
      calls.push(Object.keys(obj)[0]);
      return realSet(obj);
    };
    GA = loadGA(FILES, { browser: b });
    await Promise.all([
      GA.store.upsert("gemini:abc", { id: "t1", selector: { exact: "x" }, messages: [] }),
      GA.store.saveConvo("gemini:abc", convoRecord()),
      GA.store.upsert("gemini:abc", { id: "t2", selector: { exact: "y" }, messages: [] }),
    ]);
    expect(calls).toEqual([
      "ga:threads:gemini:abc",
      "ga:convo:gemini:abc",
      "ga:threads:gemini:abc",
    ]);
    expect((await GA.store.load("gemini:abc")).map((t) => t.id)).toEqual(["t1", "t2"]); // no lost update
  });

  describe("mergeTurns delegates to GA.core.backup.mergeTurnLists (the ONE interleave)", () => {
    it("passes the exact arguments through and returns the exact result", () => {
      const a = [T("user", "h1", 5, 0)];
      const c = [T("model", "h2", 7, 0)];
      const sentinel = [T("user", "h9", 9, 0)];
      const seen = [];
      const real = GA.core.backup.mergeTurnLists;
      GA.core.backup.mergeTurnLists = (x, y) => {
        seen.push([x, y]);
        return sentinel;
      };
      try {
        expect(GA.store.mergeTurns(a, c)).toBe(sentinel);
        expect(seen).toHaveLength(1);
        expect(seen[0][0]).toBe(a); // same references, no cloning/wrapping
        expect(seen[0][1]).toBe(c);
      } finally {
        GA.core.backup.mergeTurnLists = real;
      }
    });

    it("via the delegate: a scroll-up prepend lands before the stored turns", () => {
      const stored = [T("user", "h3", 3, 0), T("model", "h4", 4, 1)];
      const snapshot = [
        T("user", "h1", 1, 0),
        T("model", "h2", 2, 1),
        T("user", "h3", 3, 2),
        T("model", "h4", 4, 3),
      ];
      const merged = GA.store.mergeTurns(stored, snapshot);
      expect(merged.map((t) => t.fp.hash)).toEqual(["h1", "h2", "h3", "h4"]);
      expect(merged.map((t) => t.order)).toEqual([0, 1, 2, 3]); // renumbered
    });

    it("via the delegate: repeated identical turns survive as a multiset", () => {
      const cont = (order) => T("user", "hc", 8, order);
      const stored = [cont(0), T("model", "hr", 9, 1)];
      const snapshot = [cont(0), T("model", "hr", 9, 1), cont(2), T("model", "hr2", 10, 3)];
      const merged = GA.store.mergeTurns(stored, snapshot);
      expect(merged.map((t) => t.fp.hash)).toEqual(["hc", "hr", "hc", "hr2"]);
    });

    it("store.js contains no second interleave — only the delegation", () => {
      const src = fs
        .readFileSync(path.join(ROOT, "src/content/store.js"), "utf8")
        .replace(/\/\/.*$/gm, "");
      const body = src.match(/function mergeTurns\(([^)]*)\)\s*\{([\s\S]*?)\n {2}\}/);
      expect(body, "mergeTurns should be defined in store.js").toBeTruthy();
      expect(body[2].trim()).toBe("return GA.core.backup.mergeTurnLists(existingTurns, newTurns);");
    });
  });
});

describe("store.listThreadBuckets", () => {
  const seed = {
    "ga:threads:gemini:abc": [{ id: "a" }, null, { id: "b" }],
    "ga:threads:chatgpt:xyz": [{ id: "c", kind: "label", labels: ["todo"] }],
    "ga:threads:__draft__:gemini:tab_1": [{ id: "draft" }], // tab bucket, not a conversation
    "ga:threads:gemini:bad": { not: "an array" }, // unrecognized shape — skipped
    "ga:convo:gemini:abc": { v: 1, turns: [], blobs: { k: "gzipb64" } },
    "ga:settings": { scope: "section" },
  };

  it("lists every real conversation bucket, null-slots dropped, drafts/convo/settings excluded", async () => {
    const fake = makeStorageFake({ initial: seed });
    GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], {
      browser: fake.browser,
    });
    const buckets = await GA.store.listThreadBuckets();
    expect(buckets.map((b) => b.session).sort()).toEqual(["chatgpt:xyz", "gemini:abc"]);
    expect(buckets.find((b) => b.session === "gemini:abc").threads.map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("prefers getKeys() + a scoped get — the full-store get(null) is never issued", async () => {
    const fake = makeStorageFake({ initial: seed });
    const scopedGets = [];
    const origGet = fake.browser.storage.local.get;
    fake.browser.storage.local.getKeys = async () => Object.keys(fake.data);
    fake.browser.storage.local.get = async (k) => {
      scopedGets.push(k);
      return origGet(k);
    };
    GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], {
      browser: fake.browser,
    });
    const buckets = await GA.store.listThreadBuckets();
    expect(buckets.map((b) => b.session).sort()).toEqual(["chatgpt:xyz", "gemini:abc"]);
    expect(fake.getAllCount()).toBe(0);
    // the one get() was key-scoped to thread buckets — convo blobs never asked for
    expect(scopedGets).toHaveLength(1);
    expect(scopedGets[0].every((k) => k.indexOf("ga:threads:") === 0)).toBe(true);
    expect(scopedGets[0]).not.toContain("ga:convo:gemini:abc");
  });
});
