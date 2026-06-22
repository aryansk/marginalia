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

  it("clearAll removes only ga:threads:* keys", async () => {
    const b = fakeBrowser();
    GA = loadGA(["src/shared/settings-schema.js", "src/content/store.js"], { browser: b });
    b._data["ga:settings"] = { scope: "section" }; // unrelated key
    await GA.store.upsert("s1", thread("a"));
    await GA.store.clearAll();
    expect(Object.keys(b._data)).toEqual(["ga:settings"]);
  });
});
