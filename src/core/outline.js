// outline.js — pure turn/thread bookkeeping shared by the transcript exporter
// and the panel's Outline tab. No DOM, no storage: everything here takes plain
// turn records ({role, fp, text|head, order}) and thread records and returns
// plain data.
//
// Two jobs:
//  - The turn helpers transcript.js grew first (sort by capture order, prefix-
//    dedupe mid-stream partials, place a thread under its turn by fingerprint
//    then by quote containment, order threads deterministically) now live
//    here so the exporter, the bundle prompt and the outline can't drift.
//  - build() composes the Outline model: the STORED transcript index (whole
//    conversation, but only what capture has seen, and only for annotated
//    chats) unioned with the LIVE turns currently mounted in the page (the
//    only ones the panel can scroll to), keyed by role + fingerprint, grouped
//    into exchanges (a user turn plus the model turn that answers it) with
//    each exchange's threads nested under it.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.outline = (function () {
  const ROLE_LABEL = { user: "You", model: "Assistant" };

  function norm(text) {
    return GA.core.turnId.normalize(text);
  }

  // Stored index entries carry a 128-char plaintext `head`; decoded and live
  // turns carry `text`. One accessor so every helper accepts either shape.
  function defaultText(t) {
    if (!t) return "";
    if (t.text != null) return t.text;
    return t.head != null ? t.head : "";
  }

  function keyOf(role, fp) {
    if (!fp) return null;
    return (role || "") + ":" + fp.hash + ":" + fp.len;
  }

  // ---- turn helpers (moved from transcript.js) --------------------------
  function sortedTurns(convo) {
    const raw = convo && Array.isArray(convo.turns) ? convo.turns : [];
    return raw
      .filter((t) => !!t && typeof t === "object")
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const ao = typeof a.t.order === "number" ? a.t.order : Infinity;
        const bo = typeof b.t.order === "number" ? b.t.order : Infinity;
        return ao - bo || a.i - b.i;
      })
      .map((e) => e.t);
  }

  // Fix F3. Compare each turn against the LAST KEPT one so a chain of
  // partials (A, AB, ABC) collapses to its longest form. Scope is deliberate:
  // consecutive + same (truthy) role + strict prefix ONLY — no fuzzy matching,
  // no deduping across gaps, identical texts both survive (repeated identical
  // messages are legitimate and survive capture's multiset merge).
  function dedupeTurns(turns, textOf) {
    const text = textOf || defaultText;
    const kept = [];
    for (const cur of turns) {
      const prev = kept[kept.length - 1];
      if (prev && prev.role && prev.role === cur.role) {
        const a = norm(text(prev));
        const b = norm(text(cur));
        if (a && b && a !== b) {
          if (b.indexOf(a) === 0)
            kept.pop(); // prev was a stale partial of cur
          else if (a.indexOf(b) === 0) continue; // cur is a stale partial of prev
        }
      }
      kept.push(cur);
    }
    return kept;
  }

  // Placement fallback (stale-anchor recovery): a thread created while its
  // turn was still streaming recorded the PARTIAL turn's fingerprint. The
  // capture-side stale-partial upgrade replaces that fingerprint in the index
  // with the completed turn's, and prefix-dedupe can drop the partial too —
  // either way the fp match misses. The quoted text still identifies the
  // turn: place the thread under the FIRST turn (of the anchor's recorded
  // role, when present) whose text CONTAINS the quote. Containment of the
  // exact quote is strong evidence; anything weaker stays unanchored.
  function quoteFallback(thread, turns, text) {
    const exact = norm(thread && thread.selector ? thread.selector.exact : "");
    if (!exact) return -1;
    const role = thread.anchor && thread.anchor.role;
    for (let i = 0; i < turns.length; i++) {
      if (role && turns[i].role !== role) continue;
      if (norm(text(turns[i])).indexOf(exact) !== -1) return i;
    }
    return -1;
  }

  // Index of the turn a thread belongs under: FIRST turn whose fp matches the
  // recorded anchor (duplicate fps are expected for repeated identical
  // messages), else the quote fallback, else -1.
  function locateThread(thread, turns, textOf) {
    const text = textOf || defaultText;
    const fp = thread && thread.anchor && thread.anchor.turn;
    if (fp) {
      for (let j = 0; j < turns.length; j++) {
        if (GA.core.turnId.sameFingerprint(fp, turns[j].fp)) return j;
      }
    }
    return quoteFallback(thread, turns, text);
  }

  // Deterministic order for threads sharing a turn and for the unanchored
  // list: createdAt, then original array position for ties/missing stamps.
  function orderedThreads(threads) {
    const list = Array.isArray(threads) ? threads.filter(Boolean) : [];
    return list
      .map((th, i) => ({ th, i }))
      .sort((a, b) => {
        const ca = typeof a.th.createdAt === "number" ? a.th.createdAt : Infinity;
        const cb = typeof b.th.createdAt === "number" ? b.th.createdAt : Infinity;
        return ca - cb || a.i - b.i;
      })
      .map((e) => e.th);
  }

  // ---- outline rows -----------------------------------------------------
  // Gemini keeps its screen-reader labels ("You said" / "Gemini said") INSIDE
  // the turn element, so they lead both textOf() and the captured head.
  // ChatGPT and Claude keep theirs outside the turn selector.
  const GEMINI_SR_PREFIX = /^(?:you said|gemini said)\s*:?\s*/i;

  function rowText(text, role, provider, limit) {
    let s = norm(text);
    if (provider === "gemini") s = s.replace(GEMINI_SR_PREFIX, "");
    const n = typeof limit === "number" && limit > 0 ? limit : Infinity;
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // Union of the stored index and the live turns, keyed by role+fp. Live
  // entries win (they carry the element the panel can scroll to). Live turns
  // the index has never seen slot in next to the nearest live neighbour that
  // IS indexed; a run of unknown live turns with no indexed neighbour goes at
  // the end (the mounted window is usually the newest part of the chat).
  // Order is best-effort by construction — stored order is a merge-derived
  // estimate and the DOM only ever shows a window.
  function mergeTurns(stored, live) {
    const merged = stored.map((t) => ({
      key: keyOf(t.role, t.fp),
      role: t.role,
      fp: t.fp,
      text: defaultText(t),
      el: null,
      mounted: false,
    }));
    const byKey = new Map();
    for (const e of merged) if (e.key != null && !byKey.has(e.key)) byKey.set(e.key, e);

    let pending = []; // live turns with no indexed counterpart yet
    let lastHit = null; // the most recent live turn that matched the index
    for (const t of live) {
      const key = keyOf(t.role, t.fp);
      const target = key != null ? byKey.get(key) : null;
      // A repeated identical message mounts twice; the second one has no
      // free indexed slot and is treated like an unknown live turn.
      if (!target || target.mounted) {
        pending.push({
          key,
          role: t.role,
          fp: t.fp,
          text: t.text || "",
          el: t.el || null,
          mounted: true,
        });
        continue;
      }
      target.el = t.el || null;
      target.mounted = true;
      if (t.text) target.text = t.text;
      if (pending.length) {
        merged.splice(merged.indexOf(target), 0, ...pending);
        pending = [];
      }
      lastHit = target;
    }
    if (pending.length) {
      if (lastHit) merged.splice(merged.indexOf(lastHit) + 1, 0, ...pending);
      else merged.push(...pending);
    }
    return merged;
  }

  // build({ live, stored, threads, provider, limit }) -> { rows, unanchored }
  //   live:    [{ el, role, fp, text }] in DOM order (mounted turns)
  //   stored:  raw convo.turns ([{ role, fp, order, head }]) — may be empty
  //   threads: this conversation's thread records
  // Each row is one exchange: { key, role, text, el, mounted, threads, modelKey }.
  function build(opts) {
    const o = opts || {};
    const live = Array.isArray(o.live) ? o.live.filter(Boolean) : [];
    const storedList = dedupeTurns(sortedTurns({ turns: o.stored }));
    const turns = dedupeTurns(mergeTurns(storedList, live));

    const rows = [];
    const rowOf = new Array(turns.length);
    let cur = null;
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (t.role === "user" || !cur) {
        cur = {
          key: t.key,
          role: t.role === "user" ? "user" : "model",
          text: rowText(t.text, t.role, o.provider, o.limit),
          el: t.el,
          mounted: !!t.el,
          threads: [],
          modelKey: null,
        };
        rows.push(cur);
      } else if (t.role === "model" && cur.modelKey == null) {
        cur.modelKey = t.key;
      } else {
        // A second model turn in a row (regenerated answer) still belongs to
        // the same exchange; nothing new to open.
      }
      rowOf[i] = cur;
    }

    const unanchored = [];
    for (const th of orderedThreads(o.threads)) {
      const at = locateThread(th, turns);
      if (at === -1) unanchored.push(th);
      else rowOf[at].threads.push(th);
    }
    return { rows, unanchored };
  }

  return {
    ROLE_LABEL,
    keyOf,
    sortedTurns,
    dedupeTurns,
    locateThread,
    orderedThreads,
    rowText,
    mergeTurns,
    build,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.outline;
