// layout-engine.js — pure margin-layout math, extracted from gutter.js so it can
// be tested without a browser. Given each box's anchor level + natural height and
// the viewport, decide which boxes go in the margin (and where) vs. into the
// orphan drawer, and how the available height is shared.
//
// Input:  { items: [{ id, order, anchorTop|null, naturalHeight }],
//           viewport: { height }, activeId, config? }
//   anchorTop === null  => the box's highlight isn't on screen (an "orphan").
// Output: { placements: [{ id, top, height, maxHeight }],  // boxes in the margin
//           drawered: [id],                                  // orphans behind the badge
//           clusterCount }                                   // badge number (0 = no badge)
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.layout = (function () {
  const DEFAULTS = {
    GAP: 10, // vertical gap between boxes (and viewport edges)
    MARGIN: 12, // gap between the gutter and the viewport's right edge
    MAX_WIDTH: 360,
    MIN_WIDTH: 280,
    CHROME: 104, // header + composer height; box height − CHROME = message-area cap
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

  // Where the gutter column sits, right-aligned in the empty margin.
  function computeGutterBox(viewportWidth, config) {
    const c = cfg(config);
    const width = Math.max(c.MIN_WIDTH, Math.min(c.MAX_WIDTH, Math.floor(viewportWidth * c.WIDTH_FRACTION)));
    return { left: viewportWidth - width - c.MARGIN, width };
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

    return { placements: place(layoutItems, H, activeId, c), drawered, clusterCount };
  }

  function place(items, H, activeId, c) {
    if (!items.length) return [];
    const maxNatural = Math.floor(H * c.MAX_NATURAL_FRACTION);
    const work = items.map((it) => ({
      id: it.id,
      order: it.order,
      orphan: it.anchorTop == null,
      desiredTop: it.anchorTop == null ? Infinity : it.anchorTop,
      natural: Math.min(it.naturalHeight, maxNatural),
    }));
    work.sort((a, b) => a.desiredTop - b.desiredTop || a.order - b.order);

    const heights = distribute(work, H, activeId, c);

    const out = [];
    let y = c.GAP;
    for (const it of work) {
      const boxH = heights[it.id];
      const lowest = H - boxH - c.GAP;
      let top = it.orphan ? Math.max(y, lowest) : Math.max(y, Math.min(it.desiredTop, lowest));
      top = Math.max(c.GAP, Math.min(top, lowest));
      out.push({
        id: it.id,
        top,
        height: boxH,
        maxHeight: Math.max(c.MIN_MSG_HEIGHT, boxH - c.CHROME),
      });
      y = top + boxH + c.GAP;
    }
    return out;
  }

  // Decide each box's height: natural sizes if they all fit, else water-fill the
  // available height (small boxes keep natural size, large ones shrink), with the
  // focused box getting a reserved budget first.
  function distribute(work, H, activeId, c) {
    const n = work.length;
    const totalGaps = c.GAP * (n + 1);
    const naturalSum = work.reduce((s, it) => s + it.natural, 0);
    const heights = {};
    if (naturalSum + totalGaps <= H) {
      work.forEach((it) => (heights[it.id] = it.natural));
      return heights;
    }
    let avail = H - totalGaps;
    let pool = work.slice();
    const active = activeId != null ? work.find((it) => it.id === activeId) : null;
    if (active) {
      const ah = Math.min(active.natural, Math.floor(avail * c.ACTIVE_BUDGET_FRACTION));
      heights[active.id] = ah;
      avail -= ah;
      pool = pool.filter((it) => it.id !== activeId);
    }
    pool.sort((a, b) => a.natural - b.natural);
    for (let i = 0; i < pool.length; i++) {
      const share = avail / (pool.length - i);
      const h = Math.max(c.MIN_BOX_HEIGHT, Math.min(pool[i].natural, Math.floor(share)));
      heights[pool[i].id] = h;
      avail -= h;
    }
    return heights;
  }

  return { computeLayout, computeGutterBox, DEFAULTS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.layout;
