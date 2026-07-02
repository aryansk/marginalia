// cycle.js — pure next/previous selection over an ordered id list, wrapping at
// the ends. Used by keyboard thread navigation.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.cycle = (function () {
  // dir: +1 next, -1 previous. With no current id, +1 starts at the first
  // element and -1 at the last. Returns null for an empty list.
  function nextId(orderedIds, currentId, dir) {
    if (!orderedIds || !orderedIds.length) return null;
    const n = orderedIds.length;
    const idx = orderedIds.indexOf(currentId);
    if (idx < 0) return dir < 0 ? orderedIds[n - 1] : orderedIds[0];
    return orderedIds[(idx + (dir < 0 ? -1 : 1) + n) % n];
  }

  return { nextId };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.cycle;
