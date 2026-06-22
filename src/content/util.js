// util.js — shared namespace + helpers for all content scripts.
// All content scripts run in the same isolated-world global scope (manifest load order),
// so `GA` is shared across files. `var GA = GA || {}` is safe to repeat per file.
var GA = GA || {};

// Settings shape lives in shared/settings-schema.js (one source of truth across
// the content script, background, and options page).
GA.SETTINGS_KEY = GA.schema.SETTINGS_KEY;
GA.DEFAULT_SETTINGS = GA.schema.DEFAULT_SETTINGS;

GA.settings = Object.assign({}, GA.DEFAULT_SETTINGS);

GA.loadSettings = async function () {
  try {
    const obj = await browser.storage.local.get(GA.SETTINGS_KEY);
    const stored = obj[GA.SETTINGS_KEY] || {};
    GA.settings = Object.assign({}, GA.DEFAULT_SETTINGS, stored, {
      shortcut: Object.assign({}, GA.DEFAULT_SETTINGS.shortcut, stored.shortcut || {}),
    });
  } catch (e) {
    GA.settings = Object.assign({}, GA.DEFAULT_SETTINGS);
  }
  return GA.settings;
};

GA.log = function () {
  if (GA.settings && GA.settings.debug)
    console.log.apply(console, ["[gemini-assist]"].concat([].slice.call(arguments)));
};
GA.warn = function () {
  console.warn.apply(console, ["[gemini-assist]"].concat([].slice.call(arguments)));
};

GA.uid = function (prefix) {
  return (prefix || "t") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

// Session id = the <id> segment of /app/<id>. Strict per-conversation scoping.
// (Parsing lives in core/session.js so it's unit-testable.)
GA.getSessionId = function () {
  return GA.core.session.getSessionId(location.pathname);
};

// Tiny DOM builder. Never injects raw HTML — text is set via textContent.
GA.el = function (tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k === "dataset" && typeof v === "object") Object.assign(node.dataset, v);
      else if (k.slice(0, 2) === "on" && typeof v === "function")
        node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
  }
  if (children != null) {
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
  }
  return node;
};

GA.truncate = function (s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

GA.toast = function (msg) {
  let t = document.querySelector(".ga-toast");
  if (!t) {
    t = GA.el("div", { class: "ga-toast" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("ga-toast-show");
  clearTimeout(GA._toastTimer);
  GA._toastTimer = setTimeout(function () {
    t.classList.remove("ga-toast-show");
  }, GA.config.TOAST_MS);
};
