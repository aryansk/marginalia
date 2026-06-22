// loadGA — evaluate the GA-global content-script files in order against ONE
// shared `GA` object, so inter-module references (GA.core.*, GA.selection, …)
// resolve the same way they do in the browser. Used by the DOM integration
// specs (jsdom) and by specs that inject a fake `browser`.
//
// Each module is `var GA = (typeof GA !== 'undefined' && GA) || {}` at the top,
// so passing `GA` as a function parameter makes them all reuse it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadGA(relPaths, extra = {}) {
  const GA = {};
  const globals = {
    window: globalThis.window,
    document: globalThis.document,
    NodeFilter: globalThis.NodeFilter,
    Node: globalThis.Node,
    CSS: globalThis.CSS,
    location: globalThis.location,
    history: globalThis.history,
    MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame || ((f) => f()),
    ...extra,
  };
  const names = Object.keys(globals);
  for (const rel of relPaths) {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const fn = new Function("GA", ...names, "module", code);
    fn(GA, ...names.map((n) => globals[n]), { exports: {} });
  }
  return GA;
}
