// theme.js — pure color math for host-theme detection. The shell
// (content/theme-detector.js) samples the host page's computed background
// color; this module decides whether that background is light or dark. No DOM.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.theme = (function () {
  // "rgb(r, g, b)" | "rgba(r, g, b, a)" | "#rgb" | "#rrggbb" -> {r,g,b,a} or null.
  function parseCssColor(str) {
    const s = String(str == null ? "" : str).trim();
    let m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m)
      return {
        r: parseInt(m[1][0] + m[1][0], 16),
        g: parseInt(m[1][1] + m[1][1], 16),
        b: parseInt(m[1][2] + m[1][2], 16),
        a: 1,
      };
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m)
      return {
        r: parseInt(m[1].slice(0, 2), 16),
        g: parseInt(m[1].slice(2, 4), 16),
        b: parseInt(m[1].slice(4, 6), 16),
        a: 1,
      };
    return null;
  }

  // WCAG relative luminance, 0 (black) … 1 (white).
  function relativeLuminance(c) {
    function chan(v) {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  }

  // "light" | "dark" for a page background, or null when the color is
  // transparent/unparseable (caller falls back to another sample).
  function themeForBackground(colorString) {
    const c = parseCssColor(colorString);
    if (!c || c.a < 0.5) return null; // transparent — not a real page background
    return relativeLuminance(c) < 0.4 ? "dark" : "light";
  }

  return { parseCssColor, relativeLuminance, themeForBackground };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.theme;
