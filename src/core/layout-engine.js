// layout-engine.js — pure margin-layout math, extracted from gutter.js so it can
// be tested without a browser. Given each box's anchor level + natural height and
// the viewport, decide which boxes go in the margin (and where) vs. into the
// orphan drawer, and how the available height is shared.
//
// Input:  { items: [{ id, order, anchorTop|null, naturalHeight, chrome?,
//           collapsed? }], viewport: { height }, activeId, config? }
//   anchorTop === null  => the box's highlight isn't in the DOM (an "orphan").
//   chrome               => the box's measured non-messages height (header +
//                           labels + LIVE composer); falls back to the CHROME
//                           constant when absent. Keeps the engine's height
//                           prediction honest while the composer autosizes.
//   anchorTop <  0       => the highlight has scrolled above the viewport.
//   anchorTop >  height  => the highlight has scrolled below the viewport.
//   collapsed            => a minimized/resolved chip: keeps its (small)
//                           natural height, exempt from water-fill floors,
//                           gets no message-area cap (maxHeight null).
// Output: { placements: [{ id, top, height, maxHeight }],  // boxes in the margin
//           drawered: [id],                                  // orphans behind the badge
//           clusterCount,                                    // badge number (0 = no badge)
//           offAbove: [id],                                  // anchored, scrolled above the fold
//           offBelow: [id] }                                 // anchored, scrolled below the fold
//   Off-screen boxes are NOT placed — they scroll away with their highlight and are
//   surfaced to the user through the top/bottom "N comments" cues instead.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.layout = (function () {
  const DEFAULTS = {
    GAP: 10, // vertical gap between boxes (and the top edge)
    BOTTOM_GAP: 60, // clearance under the lowest box — reserves the bottom control strip
    // (panel button at 16px + 34px tall, plus the below-cue), so boxes never cover it
    MARGIN: 12, // gap between the gutter and the viewport's right edge
    MAX_WIDTH: 360,
    MIN_WIDTH: 280,
    NARROW_BREAKPOINT: 1024, // below this the gutter becomes a chip rail
    HIDE_BREAKPOINT: 600, // below this the gutter hides (highlights open the modal)
    RAIL_WIDTH: 220, // chip-rail column width
    CHROME: 104, // fallback header+composer allowance for items that carry no
    // measured `chrome`; real callers pass per-box chrome (thread-ui measures it)
    WIDTH_FRACTION: 0.32, // gutter width as a fraction of the viewport
    MAX_NATURAL_FRACTION: 0.85, // a box may claim at most this fraction of the viewport
    ACTIVE_BUDGET_FRACTION: 0.6, // the focused box gets up to this much when crowded
    MIN_BOX_HEIGHT: 80, // floor when sharing height between boxes
    MIN_MSG_HEIGHT: 48, // floor for a box's scrollable message area
    ORPHAN_CLUSTER_THRESHOLD: 2, // this many orphans (or more) collapse into the badge
  };

  function cfg(override) {
    return Object.assign({}, DEFAULTS, override || {});
  }

  // Where the gutter column sits, right-aligned in the empty margin — and in
  // which display mode (CKEditor's three-tier pattern):
  //   "full"   ≥ NARROW_BREAKPOINT: full comment cards;
  //   "rail"   < NARROW_BREAKPOINT: a slim column of chips (click → modal);
  //   "hidden" < HIDE_BREAKPOINT:   no gutter at all (highlights → modal).
  function computeGutterBox(viewportWidth, config) {
    const c = cfg(config);
    if (viewportWidth < c.HIDE_BREAKPOINT) return { left: 0, width: 0, mode: "hidden" };
    if (viewportWidth < c.NARROW_BREAKPOINT) {
      return { left: viewportWidth - c.RAIL_WIDTH - c.MARGIN, width: c.RAIL_WIDTH, mode: "rail" };
    }
    const width = Math.max(
      c.MIN_WIDTH,
      Math.min(c.MAX_WIDTH, Math.floor(viewportWidth * c.WIDTH_FRACTION)),
    );
    return { left: viewportWidth - width - c.MARGIN, width, mode: "full" };
  }

  function computeLayout(input) {
    const c = cfg(input.config);
    const H = input.viewport.height;
    const activeId = input.activeId == null ? null : input.activeId;
    const all = (input.items || []).map((it) => ({
      id: it.id,
      order: it.order || 0,
      anchorTop: it.anchorTop == null ? null : it.anchorTop,
      naturalHeight: it.naturalHeight || 0,
      chrome: it.chrome == null ? c.CHROME : it.chrome,
      collapsed: !!it.collapsed,
    }));
    const orphans = all.filter((it) => it.anchorTop == null);

    let layoutItems, drawered, clusterCount;
    if (orphans.length >= c.ORPHAN_CLUSTER_THRESHOLD) {
      drawered = orphans.map((it) => it.id);
      clusterCount = orphans.length;
      layoutItems = all.filter((it) => it.anchorTop != null);
    } else {
      // 0 or 1 orphan: everything stays in the margin (a lone orphan parks low).
      drawered = [];
      clusterCount = 0;
      layoutItems = all;
    }

    // A highlight that's still in the DOM but scrolled out of the viewport shouldn't
    // stick to the top/bottom edge — its box leaves with it. Split those out (they're
    // counted by the scroll cues) and only place the in-view ones.
    const visible = [];
    const offAbove = [];
    const offBelow = [];
    for (const it of layoutItems) {
      if (it.anchorTop == null)
        visible.push(it); // lone orphan: parks low, stays put
      else if (it.anchorTop < 0) offAbove.push(it.id);
      else if (it.anchorTop > H) offBelow.push(it.id);
      else visible.push(it);
    }

    return {
      placements: place(visible, H, activeId, c),
      drawered,
      clusterCount,
      offAbove,
      offBelow,
    };
  }

  function place(items, H, activeId, c) {
    if (!items.length) return [];
    // A box may never outgrow the vertical corridor between the top boundary
    // (GAP) and the bottom reserve — composer growth is absorbed by the
    // messages cap once both edges are pinned.
    const maxBox = Math.min(Math.floor(H * c.MAX_NATURAL_FRACTION), H - c.GAP - c.BOTTOM_GAP);
    const work = items.map((it) => {
      // The true minimum realized height: chrome is incompressible and the
      // messages area never caps below MIN_MSG_HEIGHT — but a near-empty
      // thread (scrollHeight < the floor) renders at its natural height, and
      // the floor itself must stay inside the corridor.
      const minBox = Math.min(it.naturalHeight, it.chrome + c.MIN_MSG_HEIGHT, maxBox);
      return {
        id: it.id,
        order: it.order,
        orphan: it.anchorTop == null,
        collapsed: it.collapsed,
        chrome: it.chrome,
        minBox,
        desiredTop: it.anchorTop == null ? Infinity : it.anchorTop,
        natural: it.collapsed
          ? it.naturalHeight
          : Math.max(minBox, Math.min(it.naturalHeight, maxBox)),
      };
    });
    work.sort((a, b) => a.desiredTop - b.desiredTop || a.order - b.order);

    const heights = distribute(work, H, activeId, c);
    const tops = computeTops(work, heights, H, activeId, c);

    return work.map((it) => ({
      id: it.id,
      top: tops[it.id],
      height: heights[it.id],
      maxHeight: it.collapsed ? null : Math.max(c.MIN_MSG_HEIGHT, heights[it.id] - it.chrome),
    }));
  }

  // Docs-style alignment: with no focus, boxes flow top-down from their
  // anchors. When a box is focused it is PINNED level with its anchor; earlier
  // boxes are pushed upward out of its way (they may slide past the top edge
  // when crowded — like Google Docs), later ones flow downward beneath it.
  function computeTops(work, heights, H, activeId, c) {
    const tops = {};
    const idx = activeId == null ? -1 : work.findIndex((it) => it.id === activeId && !it.orphan);

    // Flow boxes downward from `startY`. `clampToViewport` picks the regime,
    // hoisted here because it is constant per call:
    //  - true  (no pinned box): each top is clamped into [GAP, lowest] so the
    //    whole stack stays on screen;
    //  - false (boxes BELOW the pinned/focused box): the viewport clamp is
    //    intentionally DROPPED — a later box must never slide up past the
    //    pinned box, so when crowded it overflows the bottom edge instead
    //    (it scrolls away with its anchor, Docs-style).
    function flowDown(from, startY, clampToViewport) {
      let y = startY;
      for (let i = from; i < work.length; i++) {
        const it = work[i];
        const boxH = heights[it.id];
        const lowest = H - boxH - c.BOTTOM_GAP;
        let top = it.orphan ? Math.max(y, lowest) : Math.max(y, Math.min(it.desiredTop, lowest));
        if (clampToViewport) top = Math.max(c.GAP, Math.min(top, lowest));
        tops[it.id] = top;
        y = top + boxH + c.GAP;
      }
    }

    if (idx < 0) {
      flowDown(0, c.GAP, true);
      return tops;
    }

    const active = work[idx];
    const ah = heights[active.id];
    const activeTop = Math.max(c.GAP, Math.min(active.desiredTop, H - ah - c.BOTTOM_GAP));
    tops[active.id] = activeTop;

    let ceiling = activeTop;
    for (let i = idx - 1; i >= 0; i--) {
      const it = work[i];
      const boxH = heights[it.id];
      const top = Math.min(it.desiredTop, ceiling - c.GAP - boxH);
      tops[it.id] = top;
      ceiling = top;
    }

    flowDown(idx + 1, activeTop + ah + c.GAP, false);
    return tops;
  }

  // Decide each box's height: natural sizes if they all fit, else water-fill the
  // available height (small boxes keep natural size, large ones shrink), with the
  // focused box getting a reserved budget first. Collapsed chips always keep
  // their natural height — no MIN_BOX_HEIGHT floor, no active budget.
  //
  // Overflow policy: the MIN_BOX_HEIGHT and per-item minBox (chrome +
  // messages floor) floors are unconditional, so with enough boxes the floors
  // alone can exceed the budget (`avail` goes negative and every remaining
  // box still gets its floor). The summed heights then overflow the viewport,
  // which is ACCEPTED — computeTops lets the stack run past the bottom edge
  // rather than shrink boxes below usability.
  function distribute(work, H, activeId, c) {
    const n = work.length;
    const totalGaps = c.GAP * n + c.BOTTOM_GAP; // top gap + (n-1) inner gaps + bottom clearance
    const naturalSum = work.reduce((s, it) => s + it.natural, 0);
    const heights = {};
    if (naturalSum + totalGaps <= H) {
      work.forEach((it) => (heights[it.id] = it.natural));
      return heights;
    }
    let avail = H - totalGaps;
    work
      .filter((it) => it.collapsed)
      .forEach((it) => {
        heights[it.id] = it.natural;
        avail -= it.natural;
      });
    let pool = work.filter((it) => !it.collapsed);
    const active = activeId != null ? pool.find((it) => it.id === activeId) : null;
    if (active) {
      const ah = Math.max(
        active.minBox,
        Math.min(active.natural, Math.floor(avail * c.ACTIVE_BUDGET_FRACTION)),
      );
      heights[active.id] = ah;
      avail -= ah;
      pool = pool.filter((it) => it.id !== activeId);
    }
    pool.sort((a, b) => a.natural - b.natural);
    for (let i = 0; i < pool.length; i++) {
      const share = avail / (pool.length - i);
      const h = Math.max(
        c.MIN_BOX_HEIGHT,
        pool[i].minBox,
        Math.min(pool[i].natural, Math.floor(share)),
      );
      heights[pool[i].id] = h;
      avail -= h;
    }
    return heights;
  }

  // Relayout-skip guard: the gutter skips the compute+write phases entirely
  // when nothing changed (scroll frames where every anchor stayed put, mutation
  // frames that didn't touch anchors).
  // Signature: { items: [{id, order, anchorTop, naturalHeight, collapsed}],
  // height, left, width, activeId, expanded }. Note this is a SUPERSET of
  // computeLayout's input: `left`, `width` and `expanded` are not consumed by
  // the layout math, but they DO change what the gutter writes to the DOM
  // (column position/width, which box is expanded), so a skip is only correct
  // when they too are unchanged.
  function inputsEqual(a, b) {
    if (!a || !b) return false;
    if (
      a.height !== b.height ||
      a.left !== b.left ||
      a.width !== b.width ||
      a.activeId !== b.activeId ||
      a.expanded !== b.expanded ||
      a.items.length !== b.items.length
    )
      return false;
    for (let i = 0; i < a.items.length; i++) {
      const x = a.items[i];
      const y = b.items[i];
      if (
        x.id !== y.id ||
        x.order !== y.order ||
        x.anchorTop !== y.anchorTop ||
        x.naturalHeight !== y.naturalHeight ||
        x.chrome !== y.chrome ||
        x.collapsed !== y.collapsed
      )
        return false;
    }
    return true;
  }

  return { computeLayout, computeGutterBox, inputsEqual, DEFAULTS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.layout;
