// @vitest-environment jsdom
// triggers.js owns the two entry points that open a comment box on the current
// selection: the background's context-menu relay message and the configurable
// keyboard shortcut (exact-modifier match, only when text is selected).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

let realGetSelection;
beforeEach(() => {
  realGetSelection = window.getSelection;
});
afterEach(() => {
  window.getSelection = realGetSelection;
});

function makeGA({ selection = "picked text", shortcut } = {}) {
  const messageListeners = [];
  const browser = {
    runtime: { onMessage: { addListener: (fn) => messageListeners.push(fn) } },
  };
  const GA = loadGA(["src/shared/protocol.js", "src/content/triggers.js"], { browser });
  // The default shortcut from the schema: Ctrl+Shift+H.
  GA.settings =
    shortcut === undefined
      ? { shortcut: { ctrl: true, shift: true, alt: false, meta: false, key: "h" } }
      : { shortcut };
  window.getSelection = () => selection; // String(sel) is all triggers.js reads
  const onTrigger = vi.fn();
  GA.triggers.setup(onTrigger);
  return { GA, onTrigger, messageListeners };
}

function press(init) {
  const e = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  document.dispatchEvent(e);
  return e;
}

const CTRL_SHIFT_H = { key: "h", ctrlKey: true, shiftKey: true };

describe("triggers — context-menu relay", () => {
  it("fires onTrigger for the MSG_OPEN_FROM_CONTEXT message", () => {
    const { GA, onTrigger, messageListeners } = makeGA();
    expect(messageListeners).toHaveLength(1);
    messageListeners[0]({ type: GA.protocol.MSG_OPEN_FROM_CONTEXT });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("ignores other message types and malformed messages", () => {
    const { onTrigger, messageListeners } = makeGA();
    messageListeners[0]({ type: "something-else" });
    messageListeners[0](null);
    messageListeners[0]({});
    expect(onTrigger).not.toHaveBeenCalled();
  });
});

describe("triggers — keyboard shortcut", () => {
  it("fires and cancels the event on an exact modifier match with a non-empty selection", () => {
    const { onTrigger } = makeGA();
    const e = press(CTRL_SHIFT_H);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("matches the key case-insensitively (Shift makes e.key 'H')", () => {
    const { onTrigger } = makeGA();
    press({ ...CTRL_SHIFT_H, key: "H" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the selection is empty or whitespace — and never cancels the event", () => {
    const { onTrigger } = makeGA({ selection: "   " });
    const e = press(CTRL_SHIFT_H);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("an EXTRA held modifier does not match (Alt on top of Ctrl+Shift)", () => {
    const { onTrigger } = makeGA();
    press({ ...CTRL_SHIFT_H, altKey: true });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("a MISSING modifier does not match (bare H, or Ctrl+H without Shift)", () => {
    const { onTrigger } = makeGA();
    press({ key: "h" });
    press({ key: "h", ctrlKey: true });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("honors a customized shortcut from settings (Alt+M)", () => {
    const { onTrigger } = makeGA({
      shortcut: { ctrl: false, shift: false, alt: true, meta: false, key: "m" },
    });
    press({ key: "m", altKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    press(CTRL_SHIFT_H); // the old default no longer fires
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("survives settings without a shortcut (nothing fires, nothing throws)", () => {
    const { onTrigger } = makeGA({ shortcut: null });
    press(CTRL_SHIFT_H);
    press({ key: "h" });
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
