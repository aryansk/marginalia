// @vitest-environment jsdom
// adder.js owns the floating "Comment / Ask" pill: shown on mouseup only for a
// non-empty selection inside a recognized answer section (never on the [body]
// fallback, never inside the extension's own UI), positioned by the pure
// GA.core.adderPosition math, hidden on Escape/scroll/collapse, and its
// mousedown fires the createFromSelection callback while preserving the page
// selection. Real util.js/icons.js/adder-position.js; sections are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const FILES = [
  "src/shared/settings-schema.js",
  "src/core/sites.js",
  "src/core/adder-position.js",
  "src/content/util.js",
  "src/content/icons.js",
  "src/content/adder.js",
];

const RECT = { top: 100, bottom: 120, left: 40, right: 240 };

let realGetSelection;
let currentSelection;

function setSelection(node, { text = "picked", rect = RECT, collapsed = false } = {}) {
  const range = {
    toString: () => text,
    commonAncestorContainer: node,
    getBoundingClientRect: () => rect,
  };
  currentSelection = { isCollapsed: collapsed, rangeCount: 1, getRangeAt: () => range };
}

// setup() registers document/window listeners with no teardown (fine in the
// real page, which loads once). Neutralize each instance after its test via
// the settings.adder kill switch so stale listeners can't re-create pills.
const instances = [];

function makeGA({ sections } = {}) {
  const GA = loadGA(FILES);
  GA.selection = {
    findAllSections: () => (sections ? sections() : [document.getElementById("answer")]),
  };
  const onComment = vi.fn();
  GA.adder.setup(onComment);
  instances.push(GA);
  return { GA, onComment };
}

function mouseup() {
  document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  vi.advanceTimersByTime(0); // the show() path waits a tick for the selection
}

const pill = () => document.querySelector(".ga-adder");
const shown = () => !!pill() && pill().classList.contains("ga-adder-show");

beforeEach(() => {
  vi.useFakeTimers();
  realGetSelection = window.getSelection;
  currentSelection = null;
  window.getSelection = () => currentSelection;
  document.body.innerHTML = '<main id="answer"><p id="p">answer text</p></main>';
});
afterEach(() => {
  instances.forEach((GA) => {
    GA.settings.adder = false;
  });
  vi.useRealTimers();
  window.getSelection = realGetSelection;
  document.body.innerHTML = "";
});

describe("adder — show/hide decisions", () => {
  it("shows the pill for a selection inside a recognized answer section", () => {
    makeGA();
    setSelection(document.getElementById("p").firstChild); // text node -> parentElement path
    mouseup();
    expect(shown()).toBe(true);
    expect(pill().getAttribute("aria-label")).toBe("Comment on or ask about the selected text");
    expect(pill().querySelector("svg")).not.toBeNull(); // comment-plus glyph
    expect(pill().textContent).toContain("Comment / Ask");
  });

  it("positions below the selection via the shared placement math", () => {
    const { GA } = makeGA();
    setSelection(document.getElementById("p"));
    mouseup();
    // offsetWidth/Height are 0 under jsdom, so the pill uses its 110x32 fallback.
    const pos = GA.core.adderPosition.position(
      RECT,
      { width: 110, height: 32 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    expect(pos.placement).toBe("below");
    expect(pill().style.left).toBe(pos.x + "px");
    expect(pill().style.top).toBe(pos.y + "px");
  });

  it("flips above when the selection ends too close to the viewport bottom", () => {
    makeGA();
    const low = {
      top: window.innerHeight - 30,
      bottom: window.innerHeight - 10,
      left: 40,
      right: 240,
    };
    setSelection(document.getElementById("p"), { rect: low });
    mouseup();
    expect(shown()).toBe(true);
    expect(parseFloat(pill().style.top)).toBe(low.top - 6 - 32); // GAP + pill height above
  });

  it("does not show for a selection outside every recognized section", () => {
    makeGA();
    document.body.appendChild(document.createElement("aside")).id = "outside";
    setSelection(document.getElementById("outside"));
    mouseup();
    expect(shown()).toBe(false);
  });

  it("does not show on the [body] fallback (site containers not found)", () => {
    makeGA({ sections: () => [document.body] });
    setSelection(document.getElementById("p"));
    mouseup();
    expect(shown()).toBe(false);
  });

  it("does not show for collapsed or whitespace-only selections", () => {
    makeGA();
    setSelection(document.getElementById("p"), { collapsed: true });
    mouseup();
    expect(shown()).toBe(false);
    setSelection(document.getElementById("p"), { text: "   \n " });
    mouseup();
    expect(shown()).toBe(false);
  });

  it("does not show for selections inside the extension's own UI", () => {
    makeGA();
    document.body.innerHTML += '<div class="ga-modal-overlay"><span id="inside">x</span></div>';
    setSelection(document.getElementById("inside"));
    mouseup();
    expect(shown()).toBe(false);
  });

  it("respects settings.adder === false", () => {
    const { GA } = makeGA();
    GA.settings.adder = false;
    setSelection(document.getElementById("p"));
    mouseup();
    expect(pill()).toBeNull(); // never even created
  });
});

describe("adder — pill interaction and dismissal", () => {
  function showPill(ga) {
    setSelection(document.getElementById("p"));
    mouseup();
    expect(shown()).toBe(true);
    return ga;
  }

  it("mousedown on the pill hides it, cancels the event (selection survives), and fires the callback", () => {
    const { onComment } = showPill(makeGA());
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    pill().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); // the selection must survive until it's read
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(false);
  });

  it("Escape hides the pill", () => {
    showPill(makeGA());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shown()).toBe(false);
  });

  it("scrolling hides the pill", () => {
    showPill(makeGA());
    window.dispatchEvent(new Event("scroll"));
    expect(shown()).toBe(false);
  });

  it("a collapsing selection hides the pill after the debounce", () => {
    showPill(makeGA());
    currentSelection = { isCollapsed: true, rangeCount: 0 };
    document.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(119);
    expect(shown()).toBe(true); // debounce still pending
    vi.advanceTimersByTime(1);
    expect(shown()).toBe(false);
  });

  it("the pill is reused across shows — one node, re-shown after a hide", () => {
    showPill(makeGA());
    window.dispatchEvent(new Event("scroll"));
    expect(shown()).toBe(false);
    setSelection(document.getElementById("p"));
    mouseup();
    expect(shown()).toBe(true);
    expect(document.querySelectorAll(".ga-adder")).toHaveLength(1);
  });
});
