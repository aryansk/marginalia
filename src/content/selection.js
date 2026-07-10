// selection.js — capture the current selection, locate its answer "section",
// build an anchor, and wrap/unwrap highlight spans across multiple text nodes.
var GA = GA || {};

GA.selection = (function () {
  // Live registry of highlight spans per thread. anchorEl()/orphan checks are
  // pointer lookups instead of document.querySelector — they run every mutation
  // and scroll frame, so this is what keeps the observer callback cheap.
  const spansByThread = new Map(); // threadId -> [span, ...]

  // Candidate selectors for the current site's model-answer container. The exact
  // DOM changes over time; we try several and fall back to the nearest big block.
  // The per-site lists live in core/sites.js; confirm/extend against the live page.
  function responseSelectors() {
    return GA.core.sites.responseSelectors(GA.provider);
  }

  function findSection(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    if (!el) return document.body;
    for (const sel of responseSelectors()) {
      const match = el.closest(sel);
      if (match) return match;
    }
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.textContent && cur.textContent.trim().length > 200) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function findAllSections() {
    const set = new Set();
    for (const sel of responseSelectors())
      document.querySelectorAll(sel).forEach((e) => set.add(e));
    return set.size ? Array.from(set) : [document.body];
  }

  function capture() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const text = range.toString().trim();
    if (!text) return null;
    const sectionEl = findSection(range.commonAncestorContainer);
    // The selector is relative to the TURN, not to whichever nested container
    // findSection() happened to match: re-locate searches the turn, so its
    // offsets, context and occurrence index must be measured there too.
    const turn = noTurnAdapter() ? null : GA.turns.turnOf(range.commonAncestorContainer);
    const selector = GA.anchor.fromRange(range, turn ? turn.el : sectionEl);
    return {
      range,
      text,
      sectionEl,
      sectionText: (sectionEl.innerText || sectionEl.textContent || "").trim(),
      selector,
      // Who spoke, and which message. Null on a site with no turn adapter —
      // an unavailable signal, which the cascade degrades around.
      anchor: turn
        ? { v: 2, role: turn.role, turn: GA.turns.fingerprintOf(turn.el) }
        : null,
    };
  }

  // Wrap each text-node slice intersecting `range` in a highlight span.
  // Returns the list of created spans (first one is the anchor for layout).
  function highlightRange(range, threadId) {
    const spans = [];
    let root = range.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentNode;
    if (!root) return spans;

    const textNodes = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        return range.intersectsNode(n) && n.nodeValue && n.nodeValue.length
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = w.nextNode())) textNodes.push(n);

    textNodes.forEach(function (tn) {
      let s = tn === range.startContainer ? range.startOffset : 0;
      let e = tn === range.endContainer ? range.endOffset : tn.nodeValue.length;
      if (s >= e) return;
      let target = tn;
      if (s > 0) target = target.splitText(s);
      if (e - s < target.nodeValue.length) target.splitText(e - s);
      const span = document.createElement("span");
      span.className = "ga-highlight";
      span.dataset.gaThread = threadId;
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
      spans.push(span);
    });
    if (spans.length) {
      spansByThread.set(threadId, spans);
      // CSS Anchor Positioning target (used by the gutter on Chrome; inert
      // elsewhere). Thread ids are [A-Za-z0-9_], a valid dashed-ident tail.
      spans[0].style.setProperty("anchor-name", "--ga-" + threadId);
    }
    return spans;
  }

  // Keep the anchor-name on the span the layout actually measures: a site
  // re-render can kill the originally named span while later spans survive.
  // Called from the gutter's full relayout when anchored mode is on.
  function ensureAnchorName(threadId) {
    const el = anchorEl(threadId);
    if (el && !el.style.getPropertyValue("anchor-name"))
      el.style.setProperty("anchor-name", "--ga-" + threadId);
  }

  // ---------------------------------------------------------------------
  // Locating a thread: narrow to its message, never widen.
  //
  // A signal fails two ways, and conflating them is what put a comment on the
  // question above the answer it was written on:
  //   UNAVAILABLE — can't evaluate it here (turn not hydrated yet, legacy
  //                 thread, site has no adapter). No evidence → try a weaker
  //                 signal.
  //   VIOLATED    — evaluated, and it says no (this turn does not contain the
  //                 quote; the role is wrong). → orphan. Never widen.
  //
  // Widening on a *violated* signal is exactly what the old whole-document
  // fallback did. An orphan retries on every mutation and scroll, so it is also
  // the right state while a virtualized turn has not mounted yet.
  // ---------------------------------------------------------------------

  const SIM_MIN = 0.6; // stored section must reproduce this much of a candidate
  const SIM_MARGIN = 0.15; // …and beat the runner-up by this much
  const AMBIGUOUS = { ambiguous: true };

  // Sites we have no turn adapter for. Only reachable off the three hosts in
  // the manifest; keeps the old heuristic rather than orphaning everything.
  function noTurnAdapter() {
    return !GA.turns || !GA.core.sites.turnSelector(GA.provider);
  }

  function textCache() {
    const byEl = new Map();
    return function (el) {
      let t = byEl.get(el);
      if (t === undefined) {
        t = GA.anchor.textOf(el);
        byEl.set(el, t);
      }
      return t;
    };
  }

  // Which message is this thread's? Exact by fingerprint, else fuzzy against
  // the turn text we stored at capture. Returns an element, AMBIGUOUS, or null
  // (unavailable).
  function pickTurn(thread, candidates, textFor) {
    const fp = thread.anchor && thread.anchor.turn;
    if (fp) {
      const hits = candidates.filter(function (t) {
        return GA.core.turnId.sameFingerprint(GA.turns.fingerprintOf(t.el), fp);
      });
      if (hits.length === 1) return hits[0].el;
      if (hits.length > 1) return AMBIGUOUS; // duplicate messages — refuse
      // 0 hits: the turn was edited, regenerated, or was still streaming when
      // the thread was created. Not a contradiction — fall through to fuzzy.
    }
    if (!thread.section) return null; // legacy thread with nothing to compare
    let best = null,
      bestScore = 0,
      second = 0;
    candidates.forEach(function (t) {
      const s = GA.core.turnId.similarity(thread.section, textFor(t.el));
      if (s > bestScore) {
        second = bestScore;
        bestScore = s;
        best = t.el;
      } else if (s > second) {
        second = s;
      }
    });
    if (best && bestScore >= SIM_MIN && bestScore - second >= SIM_MARGIN) return best;
    return null;
  }

  // → { range, turnEl } or null (orphan).
  function locateThread(thread, textFor) {
    textFor = textFor || textCache();
    const turns = GA.turns.findTurns();
    if (!turns.length) return null; // nothing hydrated yet — orphan and retry

    // Role is a hard gate: a thread born in an answer is never offered a
    // question. A turn whose role we cannot read stays eligible (unavailable).
    const wantRole = thread.anchor && thread.anchor.role;
    const eligible = wantRole
      ? turns.filter((t) => t.role === null || t.role === wantRole)
      : turns;
    if (!eligible.length) return null;

    // Rung 1 — we know the message.
    const turnEl = pickTurn(thread, eligible, textFor);
    if (turnEl === AMBIGUOUS) return null;
    if (turnEl) {
      const range = GA.anchor.locateWithin(textFor(turnEl), thread.selector, turnEl);
      // The quote is not in the message it belongs to: VIOLATED. Orphan.
      return range ? { range: range, turnEl: turnEl } : null;
    }

    // Rung 2 — we know only the role. Structure told us little, so the text
    // must carry the load: demand reproduced context, and refuse on a tie.
    let found = null;
    for (const t of eligible) {
      const m = GA.anchor.evaluateIn(textFor(t.el), thread.selector, t.el);
      if (!m || !m.confident) continue;
      if (found) return null; // two messages equally corroborated — refuse
      found = { range: m.range, turnEl: t.el };
    }
    return found;
  }

  // Record the signals a legacy thread was created without, once we have
  // located it confidently. The population heals as the user browses.
  function backfillAnchor(thread, turnEl) {
    if (thread.anchor || !turnEl) return false;
    const role = GA.turns.roleOf(turnEl);
    if (!role) return false;
    thread.anchor = { v: 2, role: role, turn: GA.turns.fingerprintOf(turnEl) };
    return true;
  }

  // Anchor one thread. Returns its highlight spans, or [] for an orphan.
  function highlightThread(thread) {
    if (noTurnAdapter()) return highlightSelector(thread.selector, thread.id);
    const hit = locateThread(thread, textCache());
    if (!hit) return [];
    const spans = highlightRange(hit.range, thread.id);
    if (spans.length) backfillAnchor(thread, hit.turnEl);
    return spans;
  }

  // Legacy locate for sites with no turn adapter: first section that matches,
  // then the whole document. Retained only for unknown hosts — on Gemini,
  // ChatGPT and Claude the cascade above replaces it.
  function highlightSelector(selector, threadId) {
    const sections = findAllSections();
    for (const section of sections) {
      const range = GA.anchor.locate(selector, section);
      if (range) {
        const spans = highlightRange(range, threadId);
        if (spans.length) return spans;
      }
    }
    if (!(sections.length === 1 && sections[0] === document.body)) {
      const range = GA.anchor.locate(selector, document.body);
      if (range) {
        const spans = highlightRange(range, threadId);
        if (spans.length) return spans;
      }
    }
    return [];
  }

  // Batch form for the re-anchor pass: each turn's text is extracted ONCE and
  // every orphan matched against the cached strings, instead of walking the
  // document per thread, per frame. Wrapping a match in highlight spans doesn't
  // change any extracted text, so the cache stays valid across threads.
  // Returns Map(threadId -> spans).
  function reanchorAll(threads) {
    const result = new Map();
    if (!threads.length) return result;
    if (noTurnAdapter()) {
      threads.forEach((t) => result.set(t.id, highlightSelector(t.selector, t.id)));
      return result;
    }
    const textFor = textCache();
    threads.forEach(function (thread) {
      const hit = locateThread(thread, textFor);
      let spans = [];
      if (hit) {
        spans = highlightRange(hit.range, thread.id);
        if (spans.length) backfillAnchor(thread, hit.turnEl);
      }
      result.set(thread.id, spans);
    });
    return result;
  }

  function unhighlight(threadId) {
    spansByThread.delete(threadId);
    const q = 'span.ga-highlight[data-ga-thread="' + cssEscape(threadId) + '"]';
    document.querySelectorAll(q).forEach(function (span) {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }

  // Whether this environment produces client rects at all (jsdom doesn't) —
  // when it does, a span with none is inside a hidden/display:none subtree and
  // must count as orphaned rather than anchoring a box to nowhere.
  let rectsWork = null;
  function hasRects(el) {
    if (rectsWork === null)
      rectsWork = document.documentElement.getClientRects().length > 0;
    return !rectsWork || el.getClientRects().length > 0;
  }

  // The thread's live anchor span (first visible one), or null when the thread
  // is orphaned. Registry lookup only — no DOM queries on the hot path.
  function anchorEl(threadId) {
    const spans = spansByThread.get(threadId);
    if (!spans) return null;
    for (const s of spans) {
      if (s.isConnected && hasRects(s)) return s;
    }
    return null; // spans died with a re-render (or are hidden) — orphan
  }

  // Main visual state of a thread's highlight spans: "active" | "resolved" |
  // null (idle) — exclusive. Hover is a separate additive layer (below) so
  // mousing over a box can't clobber the active state.
  const HL_STATES = { active: "ga-highlight-active", resolved: "ga-highlight-resolved" };
  function setHighlightState(threadId, stateName) {
    const spans = spansByThread.get(threadId);
    if (!spans) return;
    spans.forEach((s) => {
      for (const k in HL_STATES) s.classList.toggle(HL_STATES[k], k === stateName);
    });
  }

  function setHighlightHover(threadId, on) {
    const spans = spansByThread.get(threadId);
    if (!spans) return;
    spans.forEach((s) => s.classList.toggle("ga-highlight-hover", !!on));
  }

  function setActiveHighlight(threadId, active) {
    setHighlightState(threadId, active ? "active" : null);
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
  }

  return {
    capture,
    findSection,
    findAllSections,
    highlightRange,
    highlightSelector,
    highlightThread,
    locateThread,
    reanchorAll,
    unhighlight,
    anchorEl,
    ensureAnchorName,
    setActiveHighlight,
    setHighlightState,
    setHighlightHover,
  };
})();
