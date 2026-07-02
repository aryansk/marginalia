import { describe, it, expect, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// A minimal in-memory stand-in for browser.storage.local.
function fakeBrowser() {
  const data = {};
  return {
    _data: data,
    storage: {
      local: {
        get: async (k) => {
          if (k == null) return { ...data };
          const keys = Array.isArray(k) ? k : [k];
          const out = {};
          keys.forEach((key) => {
            if (key in data) out[key] = data[key];
          });
          return out;
        },
        set: async (obj) => Object.assign(data, obj),
        remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]),
      },
    },
  };
}

let GA;
beforeEach(() => {
  GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser: fakeBrowser() });
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

  it("isStaleDraft: fresh buckets stay, old/undatable buckets are stale", () => {
    expect(GA.store.isStaleDraft([aged("a", NOW - DAY)], NOW)).toBe(false);
    expect(GA.store.isStaleDraft([aged("a", NOW - 8 * DAY)], NOW)).toBe(true);
    expect(GA.store.isStaleDraft([aged("old", NOW - 30 * DAY), aged("new", NOW - DAY)], NOW)).toBe(false);
    expect(GA.store.isStaleDraft([], NOW)).toBe(true);
    expect(GA.store.isStaleDraft([{ id: "x" }], NOW)).toBe(true); // no createdAt
  });

  function storeFor(browser, token) {
    const g = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser });
    g.provider = "gemini";
    g.tabToken = token;
    return g.store;
  }

  it("sweepDrafts adopts a fresh legacy (pre-tab-token) bucket for this provider", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini"] = [aged("legacy1", NOW - DAY)]; // old key shape
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect((await store.load(null)).map((t) => t.id)).toEqual(["legacy1"]);
    expect(b._data["ga:threads:__draft__:gemini"]).toBeUndefined();
  });

  it("sweepDrafts removes abandoned buckets but keeps other tabs' fresh drafts", async () => {
    const b = fakeBrowser();
    b._data["ga:threads:__draft__:gemini:tab_dead"] = [aged("old", NOW - 30 * DAY)];
    b._data["ga:threads:__draft__:gemini:tab_live"] = [aged("fresh", NOW - DAY)];
    b._data["ga:threads:__draft__:claude"] = [aged("other-provider", NOW - DAY)];
    b._data["ga:threads:gemini:real"] = [aged("real", NOW - 30 * DAY)]; // sessions never swept
    const store = storeFor(b, "tab_1");
    await store.sweepDrafts(NOW);
    expect(b._data["ga:threads:__draft__:gemini:tab_dead"]).toBeUndefined();
    expect(b._data["ga:threads:__draft__:gemini:tab_live"]).toBeDefined();
    expect(b._data["ga:threads:__draft__:claude"]).toBeDefined(); // another provider's legacy
    expect(b._data["ga:threads:gemini:real"]).toBeDefined();
  });
});
