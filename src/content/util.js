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

// Which AI site we're on ("gemini" | "chatgpt" | "claude" | null), derived once
// from the host. Drives the backend client, the answer selectors, and the
// per-conversation storage key. (Registry lives in core/sites.js, unit-testable.)
GA.provider = GA.core.sites.providerForHost(location.hostname);

// A stable per-tab token (survives SPA navigation and reloads, distinct across
// tabs). Namespaces the pre-id draft bucket so two tabs of the same site can't
// steal each other's draft threads when one of them gets a conversation id.
GA.tabToken = (function () {
  try {
    let t = sessionStorage.getItem("ga:tab");
    if (!t) {
      t = GA.uid("tab");
      sessionStorage.setItem("ga:tab", t);
    }
    return t;
  } catch (e) {
    return GA.uid("tab"); // sessionStorage blocked — unique per page load is still safe
  }
})();

// Storage key for the current conversation: "<provider>:<id>", or null before a
// chat has an id (the store then uses a per-provider draft bucket). Qualifying by
// provider keeps two sites' conversation ids from colliding in one storage area.
GA.getSessionId = function () {
  const id = GA.core.sites.sessionIdFromPath(GA.provider, location.pathname);
  return id ? GA.provider + ":" + id : null;
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

// Whether the browser supports CSS Anchor Positioning WELL ENOUGH to glue the
// comment boxes to their highlights during scroll (the gutter then skips all
// per-frame JS repositioning). A parse check (CSS.supports) is NOT enough: a
// browser can parse `anchor()` yet fail to resolve our anchors (Firefox began
// parsing these properties before the resolution behavior matured), in which
// case `top: anchor(top, 0px)` silently falls back to 0px and every box piles
// up at the viewport top. So probe the actual BEHAVIOR: place a hidden anchor
// at a known position and check that an anchored fixed element lands on it.
GA.supportsCssAnchor = (function () {
  let cached = null;
  return function () {
    if (cached !== null) return cached;
    cached = false;
    try {
      if (
        !window.CSS ||
        !CSS.supports ||
        !CSS.supports("anchor-name: --ga-probe") ||
        !CSS.supports("top: anchor(top, 0px)") ||
        !document.body
      )
        return cached;
      const anchor = document.createElement("div");
      anchor.style.cssText =
        "position:fixed;left:-9999px;top:137px;width:1px;height:1px;" +
        "visibility:hidden;pointer-events:none;anchor-name:--ga-probe;";
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-9999px;width:1px;height:1px;" +
        "visibility:hidden;pointer-events:none;position-anchor:--ga-probe;top:anchor(top, 0px);";
      document.body.appendChild(anchor);
      document.body.appendChild(probe);
      cached = Math.abs(probe.getBoundingClientRect().top - 137) < 1;
      anchor.remove();
      probe.remove();
    } catch (e) {
      cached = false;
    }
    return cached;
  };
})();

// Copy text to the clipboard with a confirming toast. Clipboard access can be
// denied on some pages — fall back to a quiet failure toast.
GA.copyText = function (text) {
  const p =
    navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error("clipboard unavailable"));
  p.then(
    () => GA.toast("Copied"),
    () => GA.toast("Couldn't copy — clipboard blocked on this page.")
  );
};

GA.toast = function (msg) {
  let t = document.querySelector(".ga-toast");
  if (!t) {
    t = GA.el("div", { class: "ga-toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("ga-toast-show");
  clearTimeout(GA._toastTimer);
  GA._toastTimer = setTimeout(function () {
    t.classList.remove("ga-toast-show");
  }, GA.config.TOAST_MS);
};
