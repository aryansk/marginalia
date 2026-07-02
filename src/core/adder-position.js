// adder-position.js — pure placement math for the selection "Comment" pill:
// below the selection's end, flipped above when too close to the bottom edge,
// clamped inside the viewport horizontally. No DOM.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.adderPosition = (function () {
  const EDGE = 8; // min distance from viewport edges
  const GAP = 6; // distance from the selection rect

  // rect: selection bounding rect {top,bottom,left,right}; pill: {width,height};
  // viewport: {width,height}. Returns {x, y, placement:"below"|"above"}.
  function position(rect, pill, viewport) {
    let placement = "below";
    let y = rect.bottom + GAP;
    if (y + pill.height > viewport.height - EDGE) {
      placement = "above";
      y = rect.top - GAP - pill.height;
    }
    y = Math.max(EDGE, Math.min(y, viewport.height - pill.height - EDGE));
    let x = (rect.left + rect.right) / 2 - pill.width / 2;
    x = Math.max(EDGE, Math.min(x, viewport.width - pill.width - EDGE));
    return { x, y, placement };
  }

  return { position, EDGE, GAP };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.adderPosition;
