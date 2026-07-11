import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The background modules load in two hand-maintained places: Firefox's
// manifest.json `background.scripts` array and Chrome's sw.js importScripts()
// call. They must list the same files in the same order (load order matters —
// e.g. shared/sse.js and the api-client-factory must precede the clients that
// use them). This test fails if they drift.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const fxScripts = manifest.background.scripts;

// Strip line comments first so the `importScripts()` mentioned in sw.js's header
// comment doesn't match ahead of the real call.
const sw = read("src/sw.js").replace(/\/\/.*$/gm, "");
const importBlock = sw.match(/importScripts\(([\s\S]*?)\)/);
const swScripts = importBlock
  ? [...importBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^\//, ""))
  : [];

describe("background wiring stays in sync across Firefox + Chrome", () => {
  it("manifest.json background.scripts matches sw.js importScripts (order + set)", () => {
    expect(swScripts).toEqual(fxScripts);
  });

  it("every listed background script exists on disk", () => {
    for (const rel of fxScripts) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("chrome manifest points at the sw.js service worker", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    expect(chrome.background.service_worker).toBe("src/sw.js");
  });

  it("backup core is registered in both content-script lists and the options page", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    // Same file, same position, right after the module it loads beside.
    expect(fxJs.indexOf("src/core/backup.js")).toBe(fxJs.indexOf("src/core/thread-search.js") + 1);
    expect(crJs.indexOf("src/core/backup.js")).toBe(crJs.indexOf("src/core/thread-search.js") + 1);
    // The transcript codec loads right after backup (and before store.js uses GA.core).
    expect(fxJs.indexOf("src/core/compress.js")).toBe(fxJs.indexOf("src/core/backup.js") + 1);
    expect(crJs.indexOf("src/core/compress.js")).toBe(crJs.indexOf("src/core/backup.js") + 1);
    expect(fxJs.indexOf("src/core/compress.js")).toBeLessThan(fxJs.indexOf("src/content/store.js"));
    // The transcript builder rounds out the wave-2 core block, after compress.
    expect(fxJs.indexOf("src/core/transcript.js")).toBe(fxJs.indexOf("src/core/compress.js") + 1);
    expect(crJs.indexOf("src/core/transcript.js")).toBe(crJs.indexOf("src/core/compress.js") + 1);
    // The two content-script lists never drift.
    expect(crJs).toEqual(fxJs);
    // Options page loads it after the schema it reads and before options.js.
    const html = read("src/options/options.html");
    const backupAt = html.indexOf('<script src="../core/backup.js"></script>');
    expect(backupAt).toBeGreaterThan(html.indexOf("settings-schema.js"));
    expect(backupAt).toBeLessThan(html.indexOf('<script src="options.js"></script>'));
  });

  it("convo capture is registered in both content-script lists, right after the turns module it reads", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/content/convo-capture.js")).toBe(fxJs.indexOf("src/content/turns.js") + 1);
    expect(crJs.indexOf("src/content/convo-capture.js")).toBe(crJs.indexOf("src/content/turns.js") + 1);
  });

  it("dependency helpers load before the clients that use them", () => {
    const at = (rel) => fxScripts.indexOf(rel);
    expect(at("src/shared/sse.js")).toBeGreaterThanOrEqual(0);
    // parsers use the SSE factory
    expect(at("src/shared/sse.js")).toBeLessThan(at("src/openai/parser.js"));
    expect(at("src/shared/sse.js")).toBeLessThan(at("src/anthropic/parser.js"));
    // API clients are built by the factory, which needs api-util
    expect(at("src/background/api-util.js")).toBeLessThan(at("src/background/api-client-factory.js"));
    expect(at("src/background/api-client-factory.js")).toBeLessThan(at("src/openai/client.js"));
    // dispatch reads the registry
    expect(at("src/background/registry.js")).toBeLessThan(at("src/background/clients.js"));
  });
});
