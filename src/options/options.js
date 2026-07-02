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

els.clearBtn.addEventListener("click", async () => {
  const all = await browser.storage.local.get();
  const keys = Object.keys(all).filter((k) => k.indexOf(THREADS_PREFIX) === 0);
  if (keys.length) await browser.storage.local.remove(keys);
  els.clearStatus.textContent =
    keys.length ? `Deleted threads from ${keys.length} conversation(s).` : "No saved threads.";
});

load();
