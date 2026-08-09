// @vitest-environment jsdom
// keyboard-nav.js owns the Alt-based thread shortcuts: Alt+↓/↑ cycle threads by
// gutter order (scroll the anchor into view, activate, focus the box),
// Alt+Shift+C toggles all collapsed, Alt+Shift+A toggles the panel, Alt+Shift+H
// toggles highlight visibility (all three matched by PHYSICAL key — macOS
// remaps e.key under Option+Shift); everything is inert while typing in an
// editable field. Real GA.core.cycle does the math.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function makeGA({ ids = ["a", "b", "c"], active = null } = {}) {
  const GA = loadGA(["src/core/cycle.js", "src/content/keyboard-nav.js"]);
  const anchors = {};
  const boxes = {};
  ids.forEach((id) => {
    anchors[id] = { scrollIntoView: vi.fn() };
    boxes[id] = { box: { el: { focus: vi.fn() } } };
  });
  const state = { active };
  GA.gutter = {
    orderedIds: () => ids.slice(),
    activeId: () => state.active,
    setActive: vi.fn((id) => {
      state.active = id;
    }),
    get: (id) => boxes[id] || null,
    toggleAllCollapsed: vi.fn(),
    toggleHighlightVisibility: vi.fn(),
  };
  GA.selection = { anchorEl: vi.fn((id) => anchors[id] || null) };
  GA.panel = { toggle: vi.fn() };
  GA.keyboardNav.setup();
  return { GA, anchors, boxes, state };
}

function press(init, target = document) {
  const e = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(e);
  return e;
}

const ALT_DOWN = { key: "ArrowDown", altKey: true };
const ALT_UP = { key: "ArrowUp", altKey: true };

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("keyboardNav — Alt+Arrow cycling", () => {
  it("Alt+ArrowDown with no active thread activates the first: scroll, setActive, focus", () => {
    const { GA, anchors, boxes } = makeGA();
    const e = press(ALT_DOWN);
    expect(e.defaultPrevented).toBe(true);
    expect(anchors.a.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
    expect(GA.gutter.setActive).toHaveBeenCalledWith("a");
    expect(boxes.a.box.el.focus).toHaveBeenCalledTimes(1);
  });

  it("Alt+ArrowUp with no active thread starts from the LAST thread", () => {
    const { GA } = makeGA();
    press(ALT_UP);
    expect(GA.gutter.setActive).toHaveBeenCalledWith("c");
  });

  it("cycles forward from the active id and wraps at the end", () => {
    const { GA } = makeGA({ active: "b" });
    press(ALT_DOWN);
    expect(GA.gutter.setActive).toHaveBeenLastCalledWith("c");
    press(ALT_DOWN); // c -> wraps to a
    expect(GA.gutter.setActive).toHaveBeenLastCalledWith("a");
    press(ALT_UP); // a -> wraps back to c
    expect(GA.gutter.setActive).toHaveBeenLastCalledWith("c");
  });

  it("a thread without a live anchor still activates and focuses (no crash, no scroll)", () => {
    const { GA, boxes } = makeGA();
    GA.selection.anchorEl = vi.fn(() => null);
    press(ALT_DOWN);
    expect(GA.gutter.setActive).toHaveBeenCalledWith("a");
    expect(boxes.a.box.el.focus).toHaveBeenCalledTimes(1);
  });

  it("with no threads nothing is activated", () => {
    const { GA } = makeGA({ ids: [] });
    press(ALT_DOWN);
    expect(GA.gutter.setActive).not.toHaveBeenCalled();
  });

  it("Ctrl or Meta held alongside Alt disables the shortcuts entirely", () => {
    const { GA } = makeGA();
    const e1 = press({ ...ALT_DOWN, ctrlKey: true });
    const e2 = press({ ...ALT_DOWN, metaKey: true });
    expect(GA.gutter.setActive).not.toHaveBeenCalled();
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
  });

  it("is inert while typing in an input, textarea, or contenteditable", () => {
    const { GA } = makeGA();
    document.body.innerHTML =
      '<input id="i" /><textarea id="t"></textarea><div id="c" contenteditable="true"></div>';
    for (const id of ["i", "t", "c"]) {
      press(ALT_DOWN, document.getElementById(id));
    }
    expect(GA.gutter.setActive).not.toHaveBeenCalled();
    expect(GA.gutter.toggleAllCollapsed).not.toHaveBeenCalled();
  });
});

describe("keyboardNav — Alt+Shift toggles", () => {
  it("Alt+Shift+C toggles all collapsed, matched by e.code when macOS remaps e.key", () => {
    const { GA } = makeGA();
    const e = press({ key: "Ç", code: "KeyC", altKey: true, shiftKey: true });
    expect(GA.gutter.toggleAllCollapsed).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("Alt+Shift+C also matches by e.key on platforms that don't remap", () => {
    const { GA } = makeGA();
    press({ key: "C", altKey: true, shiftKey: true });
    expect(GA.gutter.toggleAllCollapsed).toHaveBeenCalledTimes(1);
  });

  it("Alt+Shift+A toggles the panel", () => {
    const { GA } = makeGA();
    const e = press({ key: "A", code: "KeyA", altKey: true, shiftKey: true });
    expect(GA.panel.toggle).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("Alt+Shift+H toggles highlight visibility, matched by e.code when macOS remaps e.key", () => {
    const { GA } = makeGA();
    const e = press({ key: "˙", code: "KeyH", altKey: true, shiftKey: true });
    expect(GA.gutter.toggleHighlightVisibility).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("Alt+Shift+H also matches by e.key on platforms that don't remap", () => {
    const { GA } = makeGA();
    press({ key: "H", altKey: true, shiftKey: true });
    expect(GA.gutter.toggleHighlightVisibility).toHaveBeenCalledTimes(1);
  });

  it("Shift suppresses arrow cycling (Alt+Shift+ArrowDown does nothing)", () => {
    const { GA } = makeGA();
    const e = press({ ...ALT_DOWN, shiftKey: true });
    expect(GA.gutter.setActive).not.toHaveBeenCalled();
    expect(GA.gutter.toggleAllCollapsed).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("without Alt nothing fires", () => {
    const { GA } = makeGA();
    press({ key: "C", shiftKey: true });
    press({ key: "H", shiftKey: true });
    press({ key: "ArrowDown" });
    expect(GA.gutter.setActive).not.toHaveBeenCalled();
    expect(GA.gutter.toggleAllCollapsed).not.toHaveBeenCalled();
    expect(GA.gutter.toggleHighlightVisibility).not.toHaveBeenCalled();
    expect(GA.panel.toggle).not.toHaveBeenCalled();
  });
});
