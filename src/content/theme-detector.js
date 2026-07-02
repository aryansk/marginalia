// theme-detector.js — make the extension UI follow the HOST SITE's theme, not
// the OS's. Samples the page's computed background color (core/theme.js does
// the math) and stamps <html data-ga-theme="light|dark">, which content.css
// keys its dark tokens off. Re-checks when the site flips its theme class
// (ChatGPT's html.dark, Claude's data-mode, Gemini's body class — covered
// generically by observing class/style/data-* attribute flips), when the OS
// scheme changes (sites that follow it), and on SPA route changes.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.themeDetector = (function () {
  function detect() {
    const theme =
      GA.core.theme.themeForBackground(getComputedStyle(document.body).backgroundColor) ||
      GA.core.theme.themeForBackground(getComputedStyle(document.documentElement).backgroundColor);
    if (theme) document.documentElement.dataset.gaTheme = theme;
  }

  function start() {
    detect();

    const obs = new MutationObserver(function () {
      GA.frame.schedule("theme", detect);
    });
    const opts = {
      attributes: true,
      attributeFilter: ["class", "style", "data-mode", "data-theme", "data-color-scheme"],
    };
    obs.observe(document.documentElement, opts);
    if (document.body) obs.observe(document.body, opts);

    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", detect);
  }

  return { start, detect };
})();
