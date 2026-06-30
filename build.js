// build.js — assemble per-browser extension directories from one shared source
// tree. No bundler, no deps: copy src/ + icons/ and drop in the right manifest.
//   node build.js            -> builds both dist/firefox and dist/chrome
//   node build.js firefox    -> just Firefox (manifest.json, background.scripts)
//   node build.js chrome     -> just Chrome (manifest.chrome.json, service_worker)
// Then `web-ext build -s dist/<target>` (see package.json) zips each directory.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const TARGETS = {
  firefox: "manifest.json",
  chrome: "manifest.chrome.json",
};

function assemble(target) {
  const manifest = TARGETS[target];
  if (!manifest) throw new Error("Unknown target: " + target + " (use firefox|chrome)");

  const out = path.join(ROOT, "dist", target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const dir of ["src", "icons"]) {
    fs.cpSync(path.join(ROOT, dir), path.join(out, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, manifest), path.join(out, "manifest.json"));

  console.log("assembled dist/" + target + " (manifest: " + manifest + ")");
}

const args = process.argv.slice(2);
const targets = args.length ? args : Object.keys(TARGETS);
targets.forEach(assemble);
