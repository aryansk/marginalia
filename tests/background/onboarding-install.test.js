import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// First-run onboarding (A1): background.js gains a SEPARATE onInstalled
// listener that opens src/onboarding/welcome.html — on a fresh install ONLY.
// Updates ("update"/"browser_update") and reloads must stay silent, and the
// existing setupMenus listener on the same event must keep working.

function loadBackground({ tabsCreateRejects = false } = {}) {
  const onInstalled = [];
  const creates = [];
  const calls = { removeAll: 0 };
  const browser = {
    runtime: {
      id: "ext-id",
      getURL: (p) => "moz-extension://x/" + p,
      onInstalled: {
        addListener(fn) {
          onInstalled.push(fn);
        },
      },
      onStartup: { addListener() {} },
      onConnect: { addListener() {} },
      onMessage: { addListener() {} },
      openOptionsPage: () => Promise.resolve(),
    },
    contextMenus: {
      removeAll() {
        calls.removeAll++;
        return Promise.resolve();
      },
      create() {},
      onClicked: { addListener() {} },
    },
    tabs: {
      sendMessage: () => Promise.resolve(),
      create(opts) {
        creates.push(opts);
        return tabsCreateRejects ? Promise.reject(new Error("no window")) : Promise.resolve({});
      },
    },
    scripting: { executeScript: () => Promise.resolve([{ result: {} }]) },
    storage: { local: { get: () => Promise.resolve({}) } },
  };
  const GA = loadGA(
    ["src/shared/protocol.js", "src/shared/hosts.js", "src/shared/config.js", "src/background.js"],
    { browser },
  );
  const dispatchInstalled = (details) => onInstalled.forEach((fn) => fn(details));
  return { GA, browser, creates, calls, onInstalled, dispatchInstalled };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("background first-run onboarding", () => {
  it("opens the welcome page exactly once on a fresh install", () => {
    const { creates, dispatchInstalled } = loadBackground();
    dispatchInstalled({ reason: "install" });
    expect(creates).toEqual([{ url: "moz-extension://x/src/onboarding/welcome.html" }]);
  });

  it("stays silent on update, browser_update, and a missing details object", () => {
    const { creates, dispatchInstalled } = loadBackground();
    dispatchInstalled({ reason: "update" });
    dispatchInstalled({ reason: "browser_update" });
    dispatchInstalled(undefined);
    expect(creates).toEqual([]);
  });

  it("coexists with setupMenus on the same event: install still rebuilds menus", () => {
    const { creates, calls, dispatchInstalled } = loadBackground();
    // background.js already ran setupMenus once at eval time
    expect(calls.removeAll).toBe(1);
    dispatchInstalled({ reason: "install" });
    expect(calls.removeAll).toBe(2);
    expect(creates.length).toBe(1);
  });

  it("survives tabs.create rejecting (no window yet) without an unhandled error", async () => {
    const { dispatchInstalled } = loadBackground({ tabsCreateRejects: true });
    expect(() => dispatchInstalled({ reason: "install" })).not.toThrow();
    await flush(); // let the rejection propagate into the .catch
  });
});
