// turns.js — the conversation as a list of TURNS, not a soup of text.
//
// A thread belongs to the message it was created in. Locating it means finding
// that message first and searching only inside it — never scanning the page,
// where the same word in an earlier question wins by being higher up.
//
// Turn containers are the OUTERMOST match per message. Gemini's response
// selectors nest (one answer is simultaneously a <model-response>, a
// message-content, a .model-response-text, a .markdown and a
// .response-container-content), and treating nested matches as separate turns
// would read one answer as five.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.turns = (function () {
  // Fingerprints keyed by element. A message's text never changes once it has
  // finished streaming, and Gemini re-mounts turns as you scroll, so this is
  // what keeps re-anchoring off the hot path. WeakMap: entries die with the
  // node when a virtualized list unmounts it — nothing to evict.
  const fingerprints = new WeakMap();

  function sels() {
    return GA.core.sites.turnSelectors(GA.provider);
  }

  function anySelector() {
    return GA.core.sites.turnSelector(GA.provider);
  }

  function matchesAny(el, list) {
    return list.some(function (s) {
      try {
        return el.matches(s);
      } catch (e) {
        return false;
      }
    });
  }

  // "user" | "model" | null. Null means the site adapter can't tell — an
  // unavailable signal, not a contradicted one: callers must degrade, not guess.
  function roleOf(el) {
    if (!el || !el.matches) return null;
    const s = sels();
    if (matchesAny(el, s.user)) return "user";
    if (matchesAny(el, s.model)) return "model";
    return null;
  }

  // Every turn on the page, in DOM order, outermost-only. Empty when the site
  // has no adapter or nothing has hydrated yet.
  function findTurns() {
    const timed = GA.perf ? GA.perf.time : (n, fn) => fn();
    return timed("turns.findTurns", function () {
      const sel = anySelector();
      if (!sel) return [];
      let els;
      try {
        els = Array.prototype.slice.call(document.querySelectorAll(sel));
      } catch (e) {
        return [];
      }
      return els
        .filter(function (el) {
          return !els.some(function (o) {
            return o !== el && o.contains(el);
          });
        })
        .map(function (el) {
          return { el: el, role: roleOf(el) };
        });
    });
  }

  // The turn a node lives in, or null if it sits outside the conversation.
  function turnOf(node) {
    if (!node) return null;
    const el = node.nodeType === 3 ? node.parentElement : node;
    const sel = anySelector();
    if (!el || !el.closest || !sel) return null;
    let m;
    try {
      m = el.closest(sel);
    } catch (e) {
      return null;
    }
    return m ? { el: m, role: roleOf(m) } : null;
  }

  // MUST be the same extraction anchor.js uses for offsets — a matched offset is
  // mapped back to a DOM range by walking these same text nodes, so a different
  // string (e.g. raw textContent, which includes our own injected UI) would
  // shift every range. Falls back to textContent only if anchor.js is absent.
  //
  // Highlight spans wrap existing text nodes without adding text, so a turn's
  // extracted text is invariant under highlighting — which is what lets the
  // fingerprint cache and the per-pass text cache survive a re-anchor.
  function textOf(el) {
    if (!el) return "";
    return GA.anchor && GA.anchor.textOf ? GA.anchor.textOf(el) : el.textContent || "";
  }

  function fingerprintOf(el) {
    let fp = fingerprints.get(el);
    if (!fp) {
      fp = GA.core.turnId.fingerprint(textOf(el));
      fingerprints.set(el, fp);
    }
    return fp;
  }

  // Called when a mutation lands inside a turn (streaming, edit, regenerate).
  // Cheaper and more honest than re-fingerprinting the page on every batch.
  function invalidate(el) {
    if (el) fingerprints.delete(el);
  }

  return { findTurns, turnOf, roleOf, textOf, fingerprintOf, invalidate };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.turns;
