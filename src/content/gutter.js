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
    container.appendChild(drawer);
    container.appendChild(badge);
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

    // Everything else is positioned in the margin at the engine's coordinates.
    result.placements.forEach((p) => {
      const box = registry.get(p.id).box;
      box.setOrphan(!anchored[p.id]);
      box.el.classList.remove("ga-box-static");
      if (box.el.parentNode !== container) container.appendChild(box.el);
      box.el.style.top = p.top + "px";
      box.setMaxHeight(p.maxHeight);
    });

    updateCluster(result.clusterCount);
  }

  function updateCluster(count) {
    if (!badge) return;
    if (count <= 0) state.orphanExpanded = false;
    badge.style.display = count > 0 ? "flex" : "none";
    countEl.textContent = String(count);
    drawer.style.display = count > 0 && state.orphanExpanded ? "flex" : "none";
    badge.classList.toggle("ga-cluster-open", count > 0 && state.orphanExpanded);
  }

  return { init, add, remove, clear, has, get, setActive, relayout, scheduleLayout };
})();
