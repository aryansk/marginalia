// gutter.js — margin-gutter layout manager.
// Boxes live in the empty space to the right of Gemini's centered chat column,
// each level-anchored to its highlight. Resolves collisions (stack down),
// shares the viewport height when boxes would overflow, and focus-dims the
// non-active boxes.
var GA = GA || {};

GA.gutter = (function () {
  const GAP = 10;
  const MARGIN = 12;
  const MAX_WIDTH = 360;
  const MIN_WIDTH = 280;
  const CHROME = 104; // approx header + composer height, used to size message area
  const BASE_Z = 2147483000;

  let container = null;
  const registry = new Map(); // id -> { id, box, order, desiredTop, natural, orphan }
  const state = { activeId: null, order: 0, rafPending: false };

  function init() {
    if (container) return;
    container = GA.el("div", { class: "ga-gutter" });
    document.body.appendChild(container);
    window.addEventListener("scroll", scheduleLayout, true);
    window.addEventListener("resize", scheduleLayout);
  }

  function add(id, box) {
    init();
    container.appendChild(box.el);
    box.el.style.zIndex = String(BASE_Z);
    registry.set(id, { id, box, order: state.order++, desiredTop: 0, natural: 0, orphan: false });
    scheduleLayout();
  }

  function remove(id) {
    const it = registry.get(id);
    if (it) {
      it.box.destroy();
      registry.delete(id);
    }
    if (state.activeId === id) state.activeId = null;
    scheduleLayout();
  }

  function clear() {
    registry.forEach((it) => it.box.destroy());
    registry.clear();
    state.activeId = null;
  }

  function has(id) {
    return registry.has(id);
  }
  function get(id) {
    return registry.get(id);
  }

  function setActive(id) {
    state.activeId = id;
    registry.forEach((it, tid) => {
      const active = tid === id;
      it.box.setActive(active);
      it.box.setDimmed(id != null && !active);
      it.box.el.style.zIndex = String(active ? BASE_Z + 1 : BASE_Z);
      GA.selection.setActiveHighlight(tid, active);
    });
    scheduleLayout();
  }

  function scheduleLayout() {
    if (state.rafPending) return;
    state.rafPending = true;
    requestAnimationFrame(function () {
      state.rafPending = false;
      relayout();
    });
  }

  function gutterBox() {
    const vw = window.innerWidth;
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(vw * 0.32)));
    const left = vw - width - MARGIN; // right-aligned: sits in the empty margin
    return { left, width };
  }

  function relayout() {
    if (!container || !registry.size) return;
    const gb = gutterBox();
    container.style.left = gb.left + "px";
    container.style.width = gb.width + "px";

    const H = window.innerHeight;
    const items = Array.from(registry.values());

    // 1. resolve anchor levels + orphan state, reset caps to measure natural size
    items.forEach((it) => {
      const a = GA.selection.anchorEl(it.id);
      it.box.setMaxHeight(null);
      if (a) {
        it.desiredTop = a.getBoundingClientRect().top;
        it.orphan = false;
      } else {
        it.desiredTop = Number.POSITIVE_INFINITY; // park at bottom
        it.orphan = true;
      }
      it.box.setOrphan(it.orphan);
    });
    items.forEach((it) => {
      it.natural = Math.min(it.box.naturalHeight(), Math.floor(H * 0.85));
    });

    // 2. order by anchor level (stable by creation)
    items.sort((a, b) => a.desiredTop - b.desiredTop || a.order - b.order);

    // 3. decide per-box heights — share viewport height if we'd overflow
    const n = items.length;
    const totalGaps = GAP * (n + 1);
    const naturalSum = items.reduce((s, it) => s + it.natural, 0);
    const heights = {};

    if (naturalSum + totalGaps <= H) {
      items.forEach((it) => (heights[it.id] = it.natural));
    } else {
      let avail = H - totalGaps;
      let pool = items.slice();
      // active box keeps priority height
      if (state.activeId && registry.has(state.activeId)) {
        const act = registry.get(state.activeId);
        const ah = Math.min(act.natural, Math.floor(avail * 0.6));
        heights[act.id] = ah;
        avail -= ah;
        pool = pool.filter((it) => it.id !== state.activeId);
      }
      // water-fill the rest: small boxes keep natural size, large ones shrink
      pool.sort((a, b) => a.natural - b.natural);
      for (let i = 0; i < pool.length; i++) {
        const share = avail / (pool.length - i);
        const h = Math.max(80, Math.min(pool[i].natural, Math.floor(share)));
        heights[pool[i].id] = h;
        avail -= h;
      }
    }

    // 4. apply message-area caps, then place stacked (push down to avoid overlap)
    items.forEach((it) => {
      const h = heights[it.id] || it.natural;
      it.box.setMaxHeight(Math.max(48, h - CHROME));
    });

    let y = GAP;
    items.forEach((it) => {
      const boxH = it.box.el.offsetHeight;
      let top = it.orphan
        ? Math.max(y, H - boxH - GAP)
        : Math.max(y, Math.min(it.desiredTop, H - boxH - GAP));
      top = Math.max(GAP, Math.min(top, H - boxH - GAP));
      it.box.el.style.top = top + "px";
      y = top + boxH + GAP;
    });
  }

  return { init, add, remove, clear, has, get, setActive, relayout, scheduleLayout };
})();
