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
  let panelBtn = null;
  let countEl = null;
  let aboveCue = null;
  let belowCue = null;
  let aboveCountEl = null;
  let belowCountEl = null;
  const registry = new Map(); // id -> { id, box, order }
  const state = {
    activeId: null,
    order: 0,
    orphanExpanded: false,
    lastSig: null,
    mode: "full",
    anchored: false, // CSS Anchor Positioning verified working (behavior probe) — see init()
    animateNext: false, // next relayout is a deliberate shift -> ease it
    settleTimer: null, // anchored mode: debounced engine pass after scrolling
  };
  const SETTLE_MS = 200;

  function init() {
    if (container) return;
    state.anchored = !!(GA.supportsCssAnchor && GA.supportsCssAnchor());
    container = GA.el("div", { class: "ga-gutter", "aria-label": "Margin comments" });
    container.classList.toggle("ga-anchored", state.anchored);
    drawer = GA.el("div", { class: "ga-orphan-drawer" });
    countEl = GA.el("span", { class: "ga-cluster-count" });
    badge = GA.el(
      "button",
      {
        class: "ga-cluster",
        title: "Comments that lost their highlight — click to open",
        "aria-label": "Comments that lost their highlight",
        "aria-expanded": "false",
        onclick: function (e) {
          e.stopPropagation();
          toggleCluster();
        },
      },
      [
        GA.el("span", { class: "ga-cluster-glyph" }, GA.icons.make("comment-plus")),
        countEl,
        GA.el("span", { class: "ga-cluster-label", text: "detached" }),
      ],
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
      [GA.el("span", { class: "ga-scrollcue-glyph" }, GA.icons.make("chevron-up")), aboveCountEl],
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
      [GA.el("span", { class: "ga-scrollcue-glyph" }, GA.icons.make("chevron-down")), belowCountEl],
    );
    panelBtn = GA.el(
      "button",
      {
        class: "ga-panel-btn",
        title: "All comment threads (Alt+Shift+A)",
        "aria-label": "All comment threads",
        onclick: function (e) {
          e.stopPropagation();
          GA.panel.toggle();
        },
      },
      GA.icons.make("list"),
    );
    container.appendChild(drawer);
    container.appendChild(badge);
    container.appendChild(aboveCue);
    container.appendChild(belowCue);
    container.appendChild(panelBtn);
    document.body.appendChild(container);
    window.addEventListener("scroll", onAnchorsMoved, true);
    if (state.anchored) {
      // The compositor followed the anchors all through the scroll; run one
      // eased engine pass at the end to restore clamping/stacking/buckets.
      window.addEventListener(
        "scrollend",
        function () {
          if (state.settleTimer) {
            clearTimeout(state.settleTimer);
            state.settleTimer = null;
          }
          scheduleLayout({ animate: true });
        },
        true,
      );
    }
    window.addEventListener("resize", function () {
      // A viewport resize changes box widths, so every cached height is stale.
      registry.forEach((it) => it.box.invalidateHeight && it.box.invalidateHeight());
      state.lastSig = null;
      scheduleLayout();
    });
  }

  function add(id, box) {
    init();
    container.appendChild(box.el);
    box.el.style.zIndex = String(BASE_Z);
    registry.set(id, { id, box, order: state.order++ });
    scheduleLayout({ animate: true });
  }

  function remove(id) {
    const it = registry.get(id);
    if (it) {
      it.box.destroy();
      registry.delete(id);
    }
    if (state.activeId === id) state.activeId = null;
    scheduleLayout({ animate: true });
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
    if (state.activeId === id) return; // page clicks with nothing focused are free
    state.activeId = id;
    registry.forEach((it, tid) => {
      const active = tid === id;
      it.box.setActive(active);
      it.box.setDimmed(id != null && !active);
      it.box.el.style.zIndex = String(active ? BASE_Z + 1 : BASE_Z);
      GA.selection.setActiveHighlight(tid, active);
    });
    scheduleLayout({ animate: true }); // Docs-style eased shift toward the anchor
  }

  // Focus mode: a USER click activated thread `id` (its box, its chip, or its
  // page highlight). Collapse every OTHER currently-expanded box to its chip so
  // the user reads one conversation at a time, then delegate to setActive for
  // the active/dim/z bookkeeping and its single coalesced relayout. Deliberately
  // NOT inside setActive — programmatic activations (restore, Alt+↓/↑ cycling,
  // panel.go) must not collapse others. Does not force-expand or resolve the
  // target box; setCollapsed(true) on an already-collapsed (e.g. resolved) box
  // is a no-op. No explicit relayout here: each setCollapsed schedules a
  // coalesced onResize and setActive schedules the settle pass.
  function focusThread(id) {
    registry.forEach((it, tid) => {
      if (tid !== id && !it.box.isCompact()) it.box.setCollapsed(true);
    });
    setActive(id);
  }

  // Thread ids ordered by their highlight's vertical position; orphans last
  // (in creation order). Drives keyboard next/prev cycling.
  function orderedIds() {
    const anchored = [];
    const orphans = [];
    registry.forEach((it) => {
      const a = GA.selection.anchorEl(it.id);
      if (a) anchored.push({ id: it.id, top: a.getBoundingClientRect().top });
      else orphans.push({ id: it.id, order: it.order });
    });
    anchored.sort((x, y) => x.top - y.top);
    orphans.sort((x, y) => x.order - y.order);
    return anchored.concat(orphans).map((x) => x.id);
  }

  function activeId() {
    return state.activeId;
  }

  function mode() {
    return state.mode;
  }

  // Figma-style show/hide for the whole annotation layer: if anything is
  // expanded, collapse everything; otherwise expand everything.
  function toggleAllCollapsed() {
    let anyExpanded = false;
    registry.forEach((it) => {
      if (!it.box.isCompact()) anyExpanded = true;
    });
    registry.forEach((it) => it.box.setCollapsed(anyExpanded));
    scheduleLayout({ animate: true });
  }

  // Hover linking (page highlight -> box): outline + raise the hovered
  // thread's box without changing focus.
  function hoverThread(id, on) {
    const it = registry.get(id);
    if (!it) return;
    it.box.el.classList.toggle("ga-hover", !!on);
    if (!it.box.el.style.zIndex || state.activeId !== id)
      it.box.el.style.zIndex = String(on ? BASE_Z + 1 : BASE_Z);
  }

  function toggleCluster() {
    state.orphanExpanded = !state.orphanExpanded;
    state.animateNext = true;
    relayout();
  }

  // opts.animate: this relayout is a deliberate shift (focus, add/remove,
  // collapse) — ease the boxes into place. Scroll/stream/mutation callers pass
  // nothing and get instant repositioning. (Also used directly as an event
  // listener, so `opts` may be an Event — only an explicit flag counts.)
  function scheduleLayout(opts) {
    if (opts && opts.animate === true) state.animateNext = true;
    GA.frame.schedule("layout", relayout);
  }

  // Anchors moved under us (scroll; also called by the reanchorer). In JS mode
  // that means a full relayout per frame. In anchored mode the compositor is
  // already moving the boxes — just refresh the cue counts and debounce one
  // settle pass for when the movement stops.
  function onAnchorsMoved() {
    if (!state.anchored) {
      scheduleLayout();
      return;
    }
    GA.frame.schedule("cues", updateCuesLight);
    if (state.settleTimer) clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(function () {
      state.settleTimer = null;
      scheduleLayout({ animate: true });
    }, SETTLE_MS);
  }

  // Cue counts without touching geometry: cheap reads only, no engine run.
  function updateCuesLight() {
    if (!registry.size || state.mode === "hidden") return;
    const H = window.innerHeight;
    let above = 0;
    let below = 0;
    registry.forEach((it) => {
      if (it.box.el.classList.contains("ga-box-static")) return; // drawered
      const a = GA.selection.anchorEl(it.id);
      if (!a) return;
      const t = a.getBoundingClientRect().top;
      if (t < 0) above++;
      else if (t > H) below++;
    });
    updateScrollCues(above, below);
  }

  function relayout() {
    if (!container) return;
    panelBtn.style.display = registry.size ? "flex" : "none";
    if (!registry.size) {
      state.lastSig = null;
      updateCluster(0);
      updateScrollCues(0, 0);
      return;
    }

    // READ phase: gather every input first (anchor rects + cached box heights)
    // so the write phase below can't interleave reads and force reflows.
    const gb = GA.core.layout.computeGutterBox(window.innerWidth);
    state.mode = gb.mode;
    if (gb.mode === "hidden") {
      // Very narrow window: no gutter; highlights open the modal instead.
      container.style.display = "none";
      state.lastSig = null;
      return;
    }
    if (container.style.display === "none") container.style.display = "";
    container.classList.toggle("ga-rail", gb.mode === "rail");

    const viewportH = window.innerHeight;
    const items = [];
    const itemById = {};
    const anchored = {};
    registry.forEach((it) => {
      const a = GA.selection.anchorEl(it.id);
      anchored[it.id] = !!a;
      const item = {
        id: it.id,
        order: it.order,
        anchorTop: a ? a.getBoundingClientRect().top : null,
        naturalHeight: it.box.naturalHeight(),
        chrome: it.box.chromeHeight ? it.box.chromeHeight() : null,
        // rail mode renders every box as a chip
        collapsed: gb.mode === "rail" || (it.box.isCompact ? it.box.isCompact() : false),
      };
      items.push(item);
      itemById[it.id] = item;
    });

    // Nothing moved since the last pass? Skip compute + writes entirely —
    // this is what makes the per-mutation/per-scroll callback cheap.
    const sig = {
      items,
      height: viewportH,
      left: gb.left,
      width: gb.width,
      activeId: state.activeId,
      expanded: state.orphanExpanded,
    };
    if (GA.core.layout.inputsEqual(state.lastSig, sig)) return;
    state.lastSig = sig;

    // COMPUTE (pure)
    const result = GA.core.layout.computeLayout({
      items,
      viewport: { height: viewportH },
      activeId: state.activeId,
    });

    // WRITE phase
    container.classList.toggle("ga-animate", state.animateNext);
    state.animateNext = false;
    if (container.style.left !== gb.left + "px") container.style.left = gb.left + "px";
    if (container.style.width !== gb.width + "px") container.style.width = gb.width + "px";
    if (state.anchored) {
      // Anchored boxes are position:fixed (see content.css) and take the
      // gutter column's geometry from these inherited custom properties.
      const gl = gb.left + "px";
      const gw = gb.width + "px";
      if (container.style.getPropertyValue("--ga-gutter-left") !== gl)
        container.style.setProperty("--ga-gutter-left", gl);
      if (container.style.getPropertyValue("--ga-gutter-width") !== gw)
        container.style.setProperty("--ga-gutter-width", gw);
    }

    // Orphans collapsed behind the badge live in the (hidden) drawer.
    result.drawered.forEach((id) => {
      const box = registry.get(id).box;
      box.setOrphan(true);
      box.el.classList.add("ga-box-static");
      box.el.style.removeProperty("--ga-y");
      box.el.style.removeProperty("position-anchor");
      box.setMaxHeight(null);
      if (box.el.parentNode !== drawer) drawer.appendChild(box.el);
    });

    // Anchored boxes whose highlight scrolled out of view leave with it. In JS
    // mode they're hidden (repositioning them per frame at the edge would look
    // glued); in anchored mode they simply ride off with their anchor, so they
    // stay visible. The scroll cues count them either way.
    const offscreen = result.offAbove.concat(result.offBelow);
    offscreen.forEach((id) => {
      const box = registry.get(id).box;
      box.el.classList.remove("ga-box-static");
      box.el.classList.toggle("ga-box-offscreen", !state.anchored);
      if (box.el.parentNode !== container) container.appendChild(box.el);
    });

    // Everything else is positioned in the margin at the engine's coordinates.
    // JS mode: --ga-y is the absolute viewport Y. Anchored mode (Chrome, CSS
    // Anchor Positioning): `top: anchor(top)` follows the highlight natively
    // and --ga-y carries only the engine's stacking offset — constant during
    // scroll, so no JS runs per scroll frame.
    result.placements.forEach((p) => {
      const box = registry.get(p.id).box;
      const item = itemById[p.id];
      box.setOrphan(!anchored[p.id]);
      box.el.classList.remove("ga-box-static", "ga-box-offscreen");
      if (box.el.parentNode !== container) container.appendChild(box.el);
      let y;
      if (state.anchored && item.anchorTop != null) {
        GA.selection.ensureAnchorName(p.id);
        const name = "--ga-" + p.id;
        if (box.el.style.getPropertyValue("position-anchor") !== name)
          box.el.style.setProperty("position-anchor", name);
        y = Math.round(p.top - item.anchorTop);
      } else {
        if (state.anchored) box.el.style.removeProperty("position-anchor");
        y = Math.round(p.top);
      }
      const yv = y + "px";
      if (box.el.style.getPropertyValue("--ga-y") !== yv) box.el.style.setProperty("--ga-y", yv);
      box.setMaxHeight(p.maxHeight);
    });

    updateCluster(result.clusterCount);
    updateScrollCues(result.offAbove.length, result.offBelow.length);
  }

  function updateCluster(count) {
    if (!badge) return;
    if (count <= 0) state.orphanExpanded = false;
    const open = count > 0 && state.orphanExpanded;
    badge.style.display = count > 0 ? "flex" : "none";
    countEl.textContent = String(count);
    badge.setAttribute("aria-label", count + " comments lost their highlight");
    badge.setAttribute("aria-expanded", open ? "true" : "false");
    drawer.style.display = open ? "flex" : "none";
    badge.classList.toggle("ga-cluster-open", open);
  }

  function updateScrollCues(above, below) {
    if (!aboveCue) return;
    aboveCue.style.display = above > 0 ? "flex" : "none";
    aboveCountEl.textContent = String(above);
    aboveCue.setAttribute("aria-label", above + " comments above — jump to the nearest");
    belowCue.style.display = below > 0 ? "flex" : "none";
    belowCountEl.textContent = String(below);
    belowCue.setAttribute("aria-label", below + " comments below — jump to the nearest");
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

  return {
    init,
    add,
    remove,
    clear,
    has,
    get,
    setActive,
    focusThread,
    activeId,
    mode,
    orderedIds,
    toggleAllCollapsed,
    hoverThread,
    relayout,
    scheduleLayout,
    onAnchorsMoved,
  };
})();
