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

  it("tex tables + converter load right before the markdown AST that uses them", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/core/tex-unicode.js")).toBe(
      fxJs.indexOf("src/core/tex-tables.js") + 1,
    );
    expect(fxJs.indexOf("src/core/markdown-ast.js")).toBe(
      fxJs.indexOf("src/core/tex-unicode.js") + 1,
    );
    expect(crJs).toEqual(fxJs);
    for (const rel of ["src/core/tex-tables.js", "src/core/tex-unicode.js"]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("live-stream registry loads before the controller that owns it", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/core/live-stream.js")).toBe(
      fxJs.indexOf("src/core/layout-engine.js") + 1,
    );
    expect(fxJs.indexOf("src/core/live-stream.js")).toBeLessThan(
      fxJs.indexOf("src/content/thread-controller.js"),
    );
    expect(crJs).toEqual(fxJs);
    expect(fs.existsSync(path.join(ROOT, "src/core/live-stream.js"))).toBe(true);
  });

  it("convo capture is registered in both content-script lists, right after the turns module it reads", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    expect(fxJs.indexOf("src/content/convo-capture.js")).toBe(
      fxJs.indexOf("src/content/turns.js") + 1,
    );
    expect(crJs.indexOf("src/content/convo-capture.js")).toBe(
      crJs.indexOf("src/content/turns.js") + 1,
    );
  });

  it("refactor-wave modules sit at their pinned positions in both content-script lists", () => {
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const fxJs = manifest.content_scripts[0].js;
    const crJs = chrome.content_scripts[0].js;
    // convo-merge (pure merge policy) loads right after the turn identity it keys by.
    expect(fxJs.indexOf("src/core/convo-merge.js")).toBe(fxJs.indexOf("src/core/turn-id.js") + 1);
    // convo-repair (sole decompress site) loads right after the store it reads/heals.
    expect(fxJs.indexOf("src/content/convo-repair.js")).toBe(
      fxJs.indexOf("src/content/store.js") + 1,
    );
    // stream-view then dialog follow thread-turn, ahead of the surfaces built on them.
    expect(fxJs.indexOf("src/content/stream-view.js")).toBe(
      fxJs.indexOf("src/content/thread-turn.js") + 1,
    );
    expect(fxJs.indexOf("src/content/dialog.js")).toBe(
      fxJs.indexOf("src/content/stream-view.js") + 1,
    );
    // the shared composer must load before the thread box that now builds on it.
    expect(fxJs.indexOf("src/content/composer.js")).toBe(
      fxJs.indexOf("src/content/undo-stack.js") + 1,
    );
    expect(fxJs.indexOf("src/content/composer.js")).toBeLessThan(
      fxJs.indexOf("src/content/thread-ui.js"),
    );
    expect(crJs).toEqual(fxJs);
    for (const rel of [
      "src/core/convo-merge.js",
      "src/content/convo-repair.js",
      "src/content/stream-view.js",
      "src/content/dialog.js",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " should exist").toBe(true);
    }
  });

  it("release metadata stays in lockstep across both manifests and package.json", () => {
    // The version is hand-copied in three places and has drifted once before
    // (a release went out as 0.3.0 instead of 0.2.2). CI's package job also
    // keys off the package.json version — parity is load-bearing.
    const chrome = JSON.parse(read("manifest.chrome.json"));
    const pkg = JSON.parse(read("package.json"));
    expect(chrome.version).toBe(manifest.version);
    expect(pkg.version).toBe(manifest.version);
    expect(chrome.name).toBe(manifest.name);
    expect(chrome.description).toBe(manifest.description);
    expect(chrome.permissions).toEqual(manifest.permissions);
    expect(chrome.host_permissions).toEqual(manifest.host_permissions);
  });

  it("dependency helpers load before the clients that use them", () => {
    const at = (rel) => fxScripts.indexOf(rel);
    expect(at("src/shared/sse.js")).toBeGreaterThanOrEqual(0);
    // parsers use the SSE factory
    expect(at("src/shared/sse.js")).toBeLessThan(at("src/openai/parser.js"));
    expect(at("src/shared/sse.js")).toBeLessThan(at("src/anthropic/parser.js"));
    // API clients are built by the factory, which needs api-util
    expect(at("src/background/api-util.js")).toBeLessThan(
      at("src/background/api-client-factory.js"),
    );
    expect(at("src/background/api-client-factory.js")).toBeLessThan(at("src/openai/client.js"));
    // dispatch reads the registry
    expect(at("src/background/registry.js")).toBeLessThan(at("src/background/clients.js"));
  });
});
