// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { makeStorageFake } from "../helpers/storage-mock.js";

// Onboarding page script (A1): drives the REAL welcome.js against a fake
// browser.storage.local. welcome.js auto-inits only outside tests (loadGA
// injects `module`), so each spec builds its DOM, loads the script, then calls
// init() explicitly.

const SETTINGS = "ga:settings";

function setup({ initial = {} } = {}) {
  document.body.innerHTML = `
    <span id="shortcut-label"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd></span>
    <input type="password" id="openai-key" />
    <span id="key-status" role="status"></span>
    <button id="open-settings"></button>`;
  const calls = { openOptionsPage: 0 };
  const store = makeStorageFake({
    initial,
    runtime: {
      openOptionsPage() {
        calls.openOptionsPage++;
        return Promise.resolve();
      },
    },
  });
  const GA = loadGA(["src/shared/settings-schema.js", "src/onboarding/welcome.js"], {
    browser: store.browser,
  });
  const el = (id) => document.getElementById(id);
  const type = (value) => {
    el("openai-key").value = value;
    el("openai-key").dispatchEvent(new Event("input"));
  };
  return { GA, store, calls, el, type };
}

describe("onboarding welcome page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefills the key field from stored settings", async () => {
    const { GA, el } = setup({ initial: { [SETTINGS]: { openaiApiKey: "sk-old" } } });
    await GA.onboarding.init();
    expect(el("openai-key").value).toBe("sk-old");
  });

  it("saves a typed key after the debounce, preserving every other setting", async () => {
    const { GA, store, el, type } = setup({
      initial: { [SETTINGS]: { openaiApiKey: "sk-old", anthropicApiKey: "keep-me" } },
    });
    await GA.onboarding.init();
    type("  sk-new  ");
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-old"); // not yet
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS);
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-new"); // trimmed
    expect(store.data[SETTINGS].anthropicApiKey).toBe("keep-me");
    // defaults are filled in, so consumers of the bucket see a full object
    expect(store.data[SETTINGS].openaiModel).toBe(GA.schema.DEFAULT_SETTINGS.openaiModel);
    expect(el("key-status").textContent).toBe("Saved ✓");
  });

  it("re-reads storage at save time: a setting changed after init survives the save", async () => {
    const { GA, store, type } = setup({ initial: { [SETTINGS]: { scope: "section" } } });
    await GA.onboarding.init();
    type("sk-new");
    // simulate the options page (another tab) changing a setting mid-debounce
    store.data[SETTINGS].scope = "conversation";
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS);
    expect(store.data[SETTINGS].scope).toBe("conversation");
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-new");
  });

  it("debounces: rapid typing produces one write, and new input clears the status", async () => {
    const { GA, store, el, type } = setup();
    await GA.onboarding.init();
    type("sk-a");
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS - 100);
    type("sk-ab");
    await vi.advanceTimersByTimeAsync(GA.onboarding.SAVE_DEBOUNCE_MS);
    expect(store.setCalls.length).toBe(1);
    expect(store.data[SETTINGS].openaiApiKey).toBe("sk-ab");
    expect(el("key-status").textContent).toBe("Saved ✓");
    type("sk-abc");
    expect(el("key-status").textContent).toBe("");
  });

  it("renders the default shortcut into the step copy", async () => {
    const { GA, el } = setup();
    await GA.onboarding.init();
    expect(el("shortcut-label").textContent).toBe("Ctrl + Shift + H");
    expect(el("shortcut-label").querySelectorAll("kbd").length).toBe(3);
  });

  it("renders a rebound shortcut, merged over the default", async () => {
    const { GA, el } = setup({
      initial: { [SETTINGS]: { shortcut: { ctrl: false, alt: true, key: "k" } } },
    });
    await GA.onboarding.init();
    // shift stays true from the default shortcut — same merge as options.js
    expect(el("shortcut-label").textContent).toBe("Alt + Shift + K");
  });

  it("the settings button opens the options page directly", async () => {
    const { GA, calls, el } = setup();
    await GA.onboarding.init();
    el("open-settings").click();
    expect(calls.openOptionsPage).toBe(1);
  });
});
