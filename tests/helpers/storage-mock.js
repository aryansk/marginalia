// storage-mock.js — the ONE in-memory stand-in for `browser.storage.local`,
// shared by every spec that used to hand-roll its own copy. Like the real API,
// get/set exchange CLONES — callers never share object references with the
// stored values (so in-place mutation by production code can't silently
// rewrite what "storage" holds, matching real extension behavior).
//
// Options (per-file quirks live here, not in forked copies):
//   initial  seed data, cloned in (default {})
//   clone    "structured" (default) | "json" — JSON.parse(JSON.stringify) for
//            suites that also want to assert JSON-serializability of writes
//   failSet  non-empty string: every set() records its call, then throws
//            new Error(failSet) WITHOUT applying the write
//   runtime  optional `browser.runtime` stub attached to the returned browser
//
// Returns { browser, data, setCalls, removeCalls, getAllCount, clearCount }:
//   browser      pass to loadGA as the `browser` global; browser._data === data
//   data         the live backing object (inspect or pre-seed directly)
//   setCalls     every set(obj) recorded as a clone, including failed ones
//   removeCalls  every remove(keys) recorded as a normalized key array
//   getAllCount() / clearCount()  call counters for get(null) and clear()
//
// The storage methods are plain own properties, so specs can still wrap or
// replace them per-test (e.g. slow gets to widen interleaving windows).
export function makeStorageFake({
  initial = {},
  clone = "structured",
  failSet = "",
  runtime,
} = {}) {
  const cloneFn =
    clone === "json" ? (x) => JSON.parse(JSON.stringify(x)) : (x) => structuredClone(x);
  const data = cloneFn(initial);
  const setCalls = [];
  const removeCalls = [];
  let getAllCount = 0;
  let clearCount = 0;
  const local = {
    get: async (k) => {
      if (k == null) {
        getAllCount++;
        return cloneFn(data);
      }
      const keys = Array.isArray(k) ? k : [k];
      const out = {};
      keys.forEach((key) => {
        if (key in data) out[key] = cloneFn(data[key]);
      });
      return out;
    },
    set: async (obj) => {
      setCalls.push(cloneFn(obj));
      if (failSet) throw new Error(failSet);
      Object.assign(data, cloneFn(obj));
    },
    remove: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      removeCalls.push(list.slice());
      list.forEach((key) => delete data[key]);
    },
    clear: async () => {
      clearCount++;
      Object.keys(data).forEach((key) => delete data[key]);
    },
  };
  const browser = { _data: data, storage: { local } };
  if (runtime) browser.runtime = runtime;
  return {
    browser,
    data,
    setCalls,
    removeCalls,
    getAllCount: () => getAllCount,
    clearCount: () => clearCount,
  };
}
