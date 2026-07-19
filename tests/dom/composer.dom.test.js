// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Composer-local undo (GA.attachComposerUndo wired through GA.Composer): the
// clear-on-send must be reversible with Ctrl/Cmd+Z, and re-doable with
// Ctrl+Shift+Z, without disturbing Enter-to-send or native undo when idle.

function makeGA() {
  return loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/undo-stack.js",
    "src/content/composer.js",
  ]);
}

afterEach(() => {
  document.body.innerHTML = "";
});

function key(target, k, mods = {}) {
  const e = new window.KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  target.dispatchEvent(e);
  return e;
}

describe("GA.Composer undo", () => {
  it("Ctrl+Z restores sent text and re-runs autosize; Ctrl+Shift+Z re-clears", () => {
    const GA = makeGA();
    let fitCalls = 0;
    const origFit = GA.fitTextarea;
    GA.fitTextarea = (ta) => (fitCalls++, origFit(ta));

    const sent = [];
    const c = GA.Composer({ onSubmit: (t) => sent.push(t) });
    document.body.appendChild(c.el);
    const ta = c.textarea;

    ta.value = "restore me";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));

    c.el.querySelector(".ga-send").click(); // submit clears the box
    expect(ta.value).toBe("");
    expect(sent).toEqual(["restore me"]);

    const before = fitCalls;
    const e1 = key(ta, "z", { ctrlKey: true });
    expect(ta.value).toBe("restore me"); // undo brought the text back
    expect(e1.defaultPrevented).toBe(true);
    expect(fitCalls).toBeGreaterThan(before); // autosize re-ran on restore

    const e2 = key(ta, "z", { ctrlKey: true, shiftKey: true }); // redo
    expect(ta.value).toBe("");
    expect(e2.defaultPrevented).toBe(true);
  });

  it("Cmd+Z (macOS) also restores", () => {
    const GA = makeGA();
    const c = GA.Composer({ onSubmit: () => {} });
    document.body.appendChild(c.el);
    const ta = c.textarea;
    ta.value = "mac text";
    c.el.querySelector(".ga-send").click();
    expect(ta.value).toBe("");
    key(ta, "z", { metaKey: true });
    expect(ta.value).toBe("mac text");
  });

  it("Ctrl+Z on an empty stack does NOT preventDefault (native undo preserved)", () => {
    const GA = makeGA();
    const c = GA.Composer({ onSubmit: () => {} });
    document.body.appendChild(c.el);
    const e = key(c.textarea, "z", { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
  });

  it("ariaLabel overrides the placeholder-derived label; placeholder remains the fallback", () => {
    const GA = makeGA();
    const labeled = GA.Composer({
      placeholder: "Ask a follow-up about the highlighted text…",
      ariaLabel: "Ask a follow-up about the highlighted text",
      onSubmit: () => {},
    });
    expect(labeled.textarea.getAttribute("aria-label")).toBe(
      "Ask a follow-up about the highlighted text",
    );
    expect(labeled.textarea.getAttribute("placeholder")).toBe(
      "Ask a follow-up about the highlighted text…",
    );

    const fallback = GA.Composer({ placeholder: "Type here…", onSubmit: () => {} });
    expect(fallback.textarea.getAttribute("aria-label")).toBe("Type here…");
  });

  it("Enter still submits with the undo keydown listener attached", () => {
    const GA = makeGA();
    const sent = [];
    const c = GA.Composer({ onSubmit: (t) => sent.push(t) });
    document.body.appendChild(c.el);
    c.textarea.value = "via enter";
    key(c.textarea, "Enter");
    expect(sent).toEqual(["via enter"]);
    expect(c.textarea.value).toBe("");
  });
});
