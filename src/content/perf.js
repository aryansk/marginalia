// perf.js — debug-gated timing for the hot paths (reanchor, relayout, capture,
// restore, stream render). Active only while the "debug" setting is on: each
// timed span accumulates {count, total, max} per name and a compact summary is
// console.debug'd at most every few seconds. Deliberately NO per-call
// performance.measure entries — at frame rate they grow the performance buffer
// without bound. With debug off, time() is a plain call-through.
//
// Consumers use a local fallback (`GA.perf ? GA.perf.time : fn()`) so modules
// loaded standalone in node tests never depend on this file.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.perf = (function () {
  const SUMMARY_MS = 5000;
  let stats = Object.create(null);
  let lastFlush = 0;

  const enabled = () => !!(GA.settings && GA.settings.debug);

  function record(name, ms) {
    let s = stats[name];
    if (!s) s = stats[name] = { count: 0, total: 0, max: 0 };
    s.count++;
    s.total += ms;
    if (ms > s.max) s.max = ms;
    const now = performance.now();
    if (now - lastFlush >= SUMMARY_MS) {
      lastFlush = now;
      console.debug("[marginalia perf]", snapshot());
      stats = Object.create(null);
    }
  }

  // Current window's accumulators, rounded for reading. Also the test hook.
  function snapshot() {
    const out = {};
    for (const k of Object.keys(stats)) {
      const s = stats[k];
      out[k] = {
        count: s.count,
        total: Math.round(s.total * 10) / 10,
        max: Math.round(s.max * 10) / 10,
      };
    }
    return out;
  }

  function reset() {
    stats = Object.create(null);
  }

  // Times fn() under `name`. Exceptions and rejections pass through untouched;
  // a thenable result is timed to settle via a branch promise (never .finally
  // on the caller's chain — the returned promise is exactly fn()'s).
  function time(name, fn) {
    if (!enabled()) return fn();
    const t0 = performance.now();
    let result;
    try {
      result = fn();
    } catch (e) {
      record(name, performance.now() - t0);
      throw e;
    }
    if (result && typeof result.then === "function") {
      const done = () => record(name, performance.now() - t0);
      result.then(done, done);
      return result;
    }
    record(name, performance.now() - t0);
    return result;
  }

  return { time, snapshot, reset };
})();
