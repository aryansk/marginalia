// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Gear button (T-006): the panel header gains a Settings gear that asks the
// background to open the options page (content scripts can't call
// openOptionsPage directly). Drives the real panel.js with a fake `browser`.

function fakeBrowser({ reject = false } = {}) {
  const calls = [];
  return {
    calls,
    runtime: {
      sendMessage(msg) {
        calls.push(msg);
        return reject ? Promise.reject(new Error("no receiver")) : Promise.resolve();
      },
    },
  };
}

function makeGA(browser) {
  const GA = loadGA(
    [
      "src/shared/protocol.js",
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/markdown-ast.js",
      "src/core/thread-search.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/panel.js",
    ],
    { browser },
  );
  GA.threadController = { threads: () => [], expandThreadById: () => {} };
  GA.selection = { anchorEl: () => null };
  GA.gutter = { get: () => null, setActive: () => {}, mode: () => "normal" };
  return GA;
}

function header() {
  return document.querySelector(".ga-modal-header");
}
function gearBtn() {
  return document.querySelector('.ga-modal-header .ga-iconbtn[aria-label="Settings"]');
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("panel gear button (open options)", () => {
  it("renders a gear .ga-iconbtn labeled Settings in the header, with an svg icon", () => {
    makeGA(fakeBrowser()).panel.open();
    const btn = gearBtn();
    expect(btn).not.toBeNull();
    expect(btn.title).toBe("Settings");
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("keeps the close button as the header's last child, gear immediately before it", () => {
    makeGA(fakeBrowser()).panel.open();
    const kids = Array.from(header().children);
    const last = kids[kids.length - 1];
    expect(last.getAttribute("aria-label")).toBe("Close");
    expect(kids[kids.length - 2]).toBe(gearBtn());
  });

  it("clicking the gear sends exactly one MSG_OPEN_OPTIONS message", () => {
    const browser = fakeBrowser();
    const GA = makeGA(browser);
    GA.panel.open();
    gearBtn().click();
    expect(browser.calls).toEqual([{ type: GA.protocol.MSG_OPEN_OPTIONS }]);
  });

  it("a rejected sendMessage is swallowed (catch-guarded), panel stays open", async () => {
    const browser = fakeBrowser({ reject: true });
    makeGA(browser).panel.open();
    expect(() => gearBtn().click()).not.toThrow();
    await Promise.resolve(); // let the rejection propagate to the .catch guard
    await Promise.resolve();
    expect(document.querySelector(".ga-modal-overlay")).not.toBeNull();
  });

  it("GA.icons.make('gear') renders a non-empty glyph", () => {
    const GA = makeGA(fakeBrowser());
    const svg = GA.icons.make("gear");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});
