// browser-polyfill.js — tiny cross-browser shim, loaded FIRST in both the content
// scripts and the background/service worker. Firefox exposes the promise-based
// `browser.*` namespace natively; Chrome only exposes `chrome.*`. This codebase
// uses `browser.*` and awaits its results — and every MV3 API we touch
// (storage, scripting, runtime/tabs messaging, runtime.connect ports,
// contextMenus) returns a promise on Chrome when called without a callback — so
// aliasing `browser` to `chrome` is sufficient. (If an edge case ever needs more,
// swap this file for the vendored Mozilla `webextension-polyfill`.)
if (typeof globalThis.browser === "undefined" && typeof globalThis.chrome !== "undefined") {
  globalThis.browser = globalThis.chrome;
}
