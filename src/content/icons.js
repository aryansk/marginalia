// icons.js — tiny inline-SVG icon set (Lucide-style 24×24 outlines) replacing
// the old emoji/unicode glyphs, which rendered differently per platform. Built
// with createElementNS + setAttribute only — never innerHTML (XSS house rule).
// Icons inherit color via stroke="currentColor".
var GA = (typeof GA !== "undefined" && GA) || {};

GA.icons = (function () {
  const NS = "http://www.w3.org/2000/svg";

  // path data (d attributes) per icon; drawn on a 24x24 grid, stroke-width 2
  const PATHS = {
    minimize: ["M4 12h16"],
    restore: ["M4 9h16", "M4 15h10"],
    expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
    trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"],
    close: ["M18 6L6 18", "M6 6l12 12"],
    send: ["M12 19V5", "M5 12l7-7 7 7"],
    stop: ["M7 7h10v10H7z"],
    retry: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
    copy: ["M9 9h11v11H9z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
    check: ["M20 6L9 17l-5-5"],
    resolve: ["M22 12a10 10 0 1 1-10-10", "M9 12l2.5 2.5L22 4"],
    reopen: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
    "comment-plus": ["M21 12a8 8 0 0 1-8 8H4l1.5-3.2A8 8 0 1 1 21 12z", "M12 8v6", "M9 11h6"],
    "chevron-up": ["M6 15l6-6 6 6"],
    "chevron-down": ["M6 9l6 6 6-6"],
    alert: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5v.5"],
    list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
    jump: ["M5 12h14", "M12 5l7 7-7 7"],
  };

  // make("copy") -> <svg>; make("copy", 14) -> sized 14px (default 16 via CSS)
  function make(name, size) {
    const paths = PATHS[name];
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (size) {
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
    (paths || []).forEach(function (d) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  // Swap a button's icon in place (e.g. minimize <-> restore, copy -> check).
  function swap(buttonEl, name) {
    const old = buttonEl.querySelector("svg");
    if (old) old.remove();
    buttonEl.appendChild(make(name));
  }

  return { make, swap };
})();
