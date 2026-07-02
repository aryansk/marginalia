// gutter.js — the margin-gutter VIEW. It owns the DOM (container, orphan drawer,
// cluster badge), reads anchor positions + box heights from the page, asks the
// pure core/layout-engine.js where everything goes, and applies the result.
// All the positioning math lives in the engine (and is unit-tested there).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.gutter = (function () {
  const BASE_Z = 2147483000;

  let container = null;
  let drawer = null;
  let badge = null;
  let countEl = null;
  let aboveCue = null;
  let belowCue = null;
  let aboveCountEl = null;
  let belowCountEl = null;
  const registry = new Map(); // id -> { id, box, order }
  const state = { activeId: null, order: 0, rafPending: false, orphanExpanded: false };

  function init() {
    if (container) return;
    container = GA.el("div", { class: "ga-gutter" });
    drawer = GA.el("div", { class: "ga-orphan-drawer" });
    countEl = GA.el("span", { class: "ga-cluster-count" });
    badge = GA.el(
      "button",
      {
        class: "ga-cluster",
        title: "Comments that lost their highlight — click to open",
        onclick: function (e) {
          e.stopPropagation();
          toggleCluster();
        },
      },
      [GA.el("span", { class: "ga-cluster-glyph" }), countEl]
    );
    aboveCountEl = GA.el("span", { class: "ga-scrollcue-count" });
    aboveCue = GA.el(
      "button",
      {
        class: "ga-scrollcue ga-scrollcue-above",
        title: "Comments above — click to jump to the nearest",
        onclick: function (e) {
          e.stopPropagation();
          jumpTo("above");
        },
      },
      [GA.el("span", { class: "ga-scrollcue-glyph", text: "▲" }), aboveCountEl]
    );
    belowCountEl = GA.el("span", { class: "ga-scrollcue-count" });
    belowCue = GA.el(
      "button",
      {
        class: "ga-scrollcue ga-scrollcue-below",
        title: "Comments below — click to jump to the nearest",
        onclick: function (e) {
          e.stopPropagation();
          jumpTo("below");
        },
      },
      [GA.el("span", { class: "ga-scrollcue-glyph", text: "▼" }), belowCountEl]
    );
    container.appendChild(drawer);
    container.appendChild(badge);
    container.appendChild(aboveCue);
    container.appendChild(belowCue);
    document.body.appendChild(container);
    window.addEventListener("scroll", scheduleLayout, true);
    window.addEventListener("resize", scheduleLayout);
  }

  function add(id, box) {
    init();
    container.appendChild(box.el);
    box.el.style.zIndex = String(BASE_Z);
    registry.set(id, { id, box, order: state.order++ });
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
    state.orphanExpanded = false;
    scheduleLayout();
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

  function toggleCluster() {
    state.orphanExpanded = !state.orphanExpanded;
    relayout();
  }

  function scheduleLayout() {
    if (state.rafPending) return;
    state.rafPending = true;
    requestAnimationFrame(function () {
      state.rafPending = false;
      relayout();
    });
  }

  function relayout() {
    if (!container) return;
    if (!registry.size) {
      updateCluster(0);
      updateScrollCues(0, 0);
      return;
    }

    const gb = GA.core.layout.computeGutterBox(window.innerWidth);
    container.style.left = gb.left + "px";
    container.style.width = gb.width + "px";

    // Read the page: each box's anchor level (null if its highlight is gone) and
    // natural height. Then ask the engine to place them.
    const items = [];
    const anchored = {};
    registry.forEach((it) => {
      const a = GA.selection.anchorEl(it.id);
      anchored[it.id] = !!a;
      items.push({
        id: it.id,
        order: it.order,
        anchorTop: a ? a.getBoundingClientRect().top : null,
        naturalHeight: it.box.naturalHeight(),
      });
    });

    const result = GA.core.layout.computeLayout({
      items,
      viewport: { height: window.innerHeight },
      activeId: state.activeId,
    });

    // Orphans collapsed behind the badge live in the (hidden) drawer.
    result.drawered.forEach((id) => {
      const box = registry.get(id).box;
      box.setOrphan(true);
      box.el.classList.add("ga-box-static");
      box.el.style.top = "";
      box.setMaxHeight(null);
      if (box.el.parentNode !== drawer) drawer.appendChild(box.el);
    });

    // Anchored boxes whose highlight scrolled out of view leave with it: hide them
    // (kept in the container, still measurable) — the scroll cues count them instead.
    const offscreen = result.offAbove.concat(result.offBelow);
    offscreen.forEach((id) => {
      const box = registry.get(id).box;
      box.el.classList.remove("ga-box-static");
      box.el.classList.add("ga-box-offscreen");
      if (box.el.parentNode !== container) container.appendChild(box.el);
    });

    // Everything else is positioned in the margin at the engine's coordinates.
    result.placements.forEach((p) => {
      const box = registry.get(p.id).box;
      box.setOrphan(!anchored[p.id]);
      box.el.classList.remove("ga-box-static", "ga-box-offscreen");
      if (box.el.parentNode !== container) container.appendChild(box.el);
      box.el.style.top = p.top + "px";
      box.setMaxHeight(p.maxHeight);
    });

    updateCluster(result.clusterCount);
    updateScrollCues(result.offAbove.length, result.offBelow.length);
  }

  function updateCluster(count) {
    if (!badge) return;
    if (count <= 0) state.orphanExpanded = false;
    badge.style.display = count > 0 ? "flex" : "none";
    countEl.textContent = String(count);
    drawer.style.display = count > 0 && state.orphanExpanded ? "flex" : "none";
    badge.classList.toggle("ga-cluster-open", count > 0 && state.orphanExpanded);
  }

  function updateScrollCues(above, below) {
    if (!aboveCue) return;
    aboveCue.style.display = above > 0 ? "flex" : "none";
    aboveCountEl.textContent = String(above);
    belowCue.style.display = below > 0 ? "flex" : "none";
    belowCountEl.textContent = String(below);
  }

  // Scroll to the nearest comment whose highlight is off-screen in `dir` ("above" or
  // "below"). Reads live rects (scroll may have moved since the last relayout). The
  // resulting scroll fires the scroll listener, which re-runs relayout and brings the
  // box back into the margin.
  function jumpTo(dir) {
    const H = window.innerHeight;
    let best = null;
    let bestTop = null;
    registry.forEach((it) => {
      const a = GA.selection.anchorEl(it.id);
      if (!a) return;
      const t = a.getBoundingClientRect().top;
      if (dir === "above") {
        if (t < 0 && (bestTop == null || t > bestTop)) {
          bestTop = t;
          best = a;
        }
      } else if (t > H && (bestTop == null || t < bestTop)) {
        bestTop = t;
        best = a;
      }
    });
    if (best) best.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return { init, add, remove, clear, has, get, setActive, relayout, scheduleLayout };
})();
