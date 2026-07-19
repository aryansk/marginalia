// options.js — settings page (runs as an extension page, not a content script).
// Schema comes from shared/settings-schema.js (loaded just before this file).
const SETTINGS_KEY = GA.schema.SETTINGS_KEY;
const DEFAULTS = GA.schema.DEFAULT_SETTINGS;
const THREADS_PREFIX = GA.schema.THREADS_PREFIX;

const els = {
  shortcutBtn: document.getElementById("shortcut-btn"),
  shortcutReset: document.getElementById("shortcut-reset"),
  shortcutStatus: document.getElementById("shortcut-status"),
  clearBtn: document.getElementById("clear-btn"),
  clearStatus: document.getElementById("clear-status"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFile: document.getElementById("import-file"),
  importReplace: document.getElementById("import-replace"),
  backupStatus: document.getElementById("backup-status"),
  adder: document.getElementById("adder"),
  debug: document.getElementById("debug"),
  apikeysStatus: document.getElementById("apikeys-status"),
};

// settings field <-> input id, for the optional API-key backends
const API_FIELDS = {
  openaiApiKey: "openai-key",
  openaiModel: "openai-model",
  geminiApiKey: "gemini-key",
  geminiModel: "gemini-model",
  anthropicApiKey: "anthropic-key",
  anthropicModel: "anthropic-model",
};

let settings = Object.assign({}, DEFAULTS);
let recording = false;

function fmtShortcut(sc) {
  const parts = [];
  if (sc.ctrl) parts.push("Ctrl");
  if (sc.alt) parts.push("Alt");
  if (sc.shift) parts.push("Shift");
  if (sc.meta) parts.push("Cmd");
  parts.push((sc.key || "").toUpperCase());
  return parts.join(" + ");
}

async function load() {
  const obj = await browser.storage.local.get(SETTINGS_KEY);
  const stored = obj[SETTINGS_KEY] || {};
  settings = Object.assign({}, DEFAULTS, stored, {
    shortcut: Object.assign({}, DEFAULTS.shortcut, stored.shortcut || {}),
  });
  render();
}

function render() {
  els.shortcutBtn.textContent = fmtShortcut(settings.shortcut);
  document.querySelectorAll('input[name="scope"]').forEach((r) => {
    r.checked = r.value === settings.scope;
  });
  els.adder.checked = settings.adder !== false;
  els.debug.checked = !!settings.debug;
  Object.keys(API_FIELDS).forEach((field) => {
    const input = document.getElementById(API_FIELDS[field]);
    if (input) input.value = settings[field] == null ? "" : settings[field];
  });
}

async function save() {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

// shortcut capture
els.shortcutBtn.addEventListener("click", () => {
  recording = true;
  els.shortcutBtn.classList.add("recording");
  els.shortcutBtn.textContent = "Press keys…";
  els.shortcutStatus.textContent = "";
});

window.addEventListener("keydown", async (e) => {
  if (!recording) return;
  e.preventDefault();
  const key = e.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return; // wait for a real key
  settings.shortcut = {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    key,
  };
  recording = false;
  els.shortcutBtn.classList.remove("recording");
  render();
  await save();
  els.shortcutStatus.textContent = "Saved.";
});

els.shortcutReset.addEventListener("click", async () => {
  settings.shortcut = Object.assign({}, DEFAULTS.shortcut);
  render();
  await save();
  els.shortcutStatus.textContent = "Reset to default.";
});

document.querySelectorAll('input[name="scope"]').forEach((r) => {
  r.addEventListener("change", async () => {
    if (r.checked) {
      settings.scope = r.value;
      await save();
    }
  });
});

els.adder.addEventListener("change", async () => {
  settings.adder = els.adder.checked;
  await save();
});

els.debug.addEventListener("change", async () => {
  settings.debug = els.debug.checked;
  await save();
});

// API keys + models — save on input (debounced so we don't write on every keystroke)
let apikeysTimer = 0;
Object.keys(API_FIELDS).forEach((field) => {
  const input = document.getElementById(API_FIELDS[field]);
  if (!input) return;
  input.addEventListener("input", () => {
    settings[field] = input.value.trim();
    clearTimeout(apikeysTimer);
    apikeysTimer = setTimeout(async () => {
      await save();
      els.apikeysStatus.textContent = "Saved.";
    }, 400);
  });
});

// ---- Backup: export / import (GA.core.backup, loaded just before this file) ----

// Count thread records (N) and conversation buckets (M) in a threads map
// ({ "ga:threads:<id>": [thread, …] }), e.g. an archive envelope's `threads`.
// Only buckets the import engine would actually ACCEPT (correctly prefixed,
// array-shaped) are counted, so the status line never claims rejected data.
function threadCounts(threadsObj) {
  const src = threadsObj && typeof threadsObj === "object" ? threadsObj : {};
  const buckets = Object.keys(src).filter(
    (k) => k.indexOf(THREADS_PREFIX) === 0 && Array.isArray(src[k]),
  );
  let records = 0;
  buckets.forEach((k) => {
    records += src[k].length;
  });
  return { records, buckets: buckets.length };
}

// Total thread records currently in a full storage object (allowlisted by prefix).
function storedThreadCount(all) {
  let n = 0;
  Object.keys(all || {}).forEach((k) => {
    if (k.indexOf(THREADS_PREFIX) === 0 && Array.isArray(all[k])) n += all[k].length;
  });
  return n;
}

function ymdStamp(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// Download `text` as a JSON file via a temporary anchor; always revokes the URL.
function downloadJson(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Deferred: revoking in the same task as click() can intermittently abort
    // the download in Firefox before it dereferences the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

els.exportBtn.addEventListener("click", async () => {
  try {
    const all = await browser.storage.local.get();
    const env = GA.core.backup.buildExport(all, Date.now());
    const { records, buckets } = threadCounts(env.threads);
    downloadJson(
      JSON.stringify(env, null, 2),
      `marginalia-threads-${ymdStamp(new Date(env.exportedAt))}.json`,
    );
    els.backupStatus.textContent = `Exported ${records} thread(s) from ${buckets} conversation(s).`;
  } catch (err) {
    els.backupStatus.textContent = "Export failed: " + ((err && err.message) || String(err));
  }
});

els.importBtn.addEventListener("click", () => {
  els.importFile.click();
});

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files && els.importFile.files[0];
  // Reset immediately so choosing the same file again re-fires "change".
  // (The File reference stays readable after the input is cleared.)
  els.importFile.value = "";
  if (!file) return;
  try {
    // Read outside the parse-guard so a file READ error (file moved/changed
    // since it was picked) reports as itself, not as invalid JSON.
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      els.backupStatus.textContent =
        "Import failed: that file isn't valid JSON. Nothing was changed.";
      return;
    }
    if (!parsed || parsed.format !== GA.core.backup.FORMAT) {
      els.backupStatus.textContent =
        "Import failed: that file isn't a Marginalia backup. Nothing was changed.";
      return;
    }
    const replace = els.importReplace.checked;
    if (replace) {
      // The one destructive path: confirm BEFORE any storage access.
      const ok = confirm(
        "Replace instead of merge: your current threads for every conversation in " +
          "this backup will be discarded and replaced by the backup's. Continue?",
      );
      if (!ok) {
        els.backupStatus.textContent = "Import cancelled — nothing was changed.";
        return;
      }
    }
    const existing = await browser.storage.local.get();
    const before = storedThreadCount(existing);
    const next = GA.core.backup.mergeImport(existing, parsed, {
      mode: replace ? "replace" : "merge",
    });
    await browser.storage.local.set(next);
    const { records, buckets } = threadCounts(parsed.threads);
    const gained = Math.max(0, storedThreadCount(next) - before);
    els.backupStatus.textContent = `Imported ${records} thread(s) into ${buckets} conversation(s) (${gained} new).`;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    els.backupStatus.textContent = /quota/i.test(msg)
      ? "Import failed: this browser's extension storage is full (quota exceeded). Nothing was changed."
      : "Import failed: " + msg + " Nothing was changed.";
  }
});

els.clearBtn.addEventListener("click", async () => {
  const all = await browser.storage.local.get();
  const keys = Object.keys(all).filter((k) => k.indexOf(THREADS_PREFIX) === 0);
  if (keys.length) await browser.storage.local.remove(keys);
  els.clearStatus.textContent = keys.length
    ? `Deleted threads from ${keys.length} conversation(s).`
    : "No saved threads.";
});

load();
