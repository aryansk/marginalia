// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.dialog — the shared overlay-dialog lifecycle the modal and the panel run
// on: overlay attributes, backdrop-mousedown close, Escape (with the onEscape
// veto), the Tab focus trap, opener-focus restore, and idempotent close.

function makeGA() {
  return loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/dialog.js",
  ]);
}

function content(GA) {
  // Three focusables in document order, plus a disabled one the trap must skip.
  const first = GA.el("button", { class: "b-first", text: "first" });
  const mid = GA.el("input", { class: "b-mid", type: "text" });
  const last = GA.el("button", { class: "b-last", text: "last" });
  const disabled = GA.el("button", { text: "disabled" });
  disabled.disabled = true;
  const el = GA.el("div", { class: "dlg-content" }, [first, mid, disabled, last]);
  return { el, first, mid, last };
}

// jsdom has no layout, so offsetParent is always null and the trap's
// visibility filter would see nothing — pretend everything is laid out.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
});
afterEach(() => {
  delete HTMLElement.prototype.offsetParent;
  document.body.innerHTML = "";
});

const escape = () =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
const tab = (shift = false) => {
  const e = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(e);
  return e;
};

describe("GA.dialog.open — overlay shape", () => {
  it("builds an accessible overlay, appends the content, and focuses initialFocus", () => {
    const GA = makeGA();
    const c = content(GA);
    const dlg = GA.dialog.open({
      label: "Test dialog",
      className: "ga-extra",
      content: c.el,
      initialFocus: c.first,
    });

    const overlay = document.querySelector(".ga-modal-overlay");
    expect(overlay).toBe(dlg.overlay);
    expect(overlay.classList.contains("ga-extra")).toBe(true);
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-label")).toBe("Test dialog");
    expect(overlay.querySelector(".dlg-content")).toBe(c.el);
    expect(document.activeElement).toBe(c.first);
    expect(dlg.isOpen()).toBe(true);
  });

  it("mousedown on the backdrop closes; mousedown on the content does not", () => {
    const GA = makeGA();
    const c = content(GA);
    const dlg = GA.dialog.open({ label: "x", content: c.el });

    c.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dlg.isOpen()).toBe(true);

    dlg.overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dlg.isOpen()).toBe(false);
    expect(document.querySelector(".ga-modal-overlay")).toBeNull();
  });
});

describe("GA.dialog — Escape and the onEscape veto", () => {
  it("Escape closes when there is no onEscape hook", () => {
    const GA = makeGA();
    const dlg = GA.dialog.open({ label: "x", content: content(GA).el });
    escape();
    expect(dlg.isOpen()).toBe(false);
  });

  it("onEscape returning true keeps the dialog open; false lets it close", () => {
    const GA = makeGA();
    let veto = true;
    const onEscape = vi.fn(() => veto);
    const dlg = GA.dialog.open({ label: "x", content: content(GA).el, onEscape });

    escape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(dlg.isOpen()).toBe(true); // vetoed

    veto = false;
    escape();
    expect(dlg.isOpen()).toBe(false);
  });
});

describe("GA.dialog — Tab focus trap", () => {
  it("Tab on the last focusable wraps to the first; Shift+Tab on the first wraps to the last", () => {
    const GA = makeGA();
    const c = content(GA);
    GA.dialog.open({ label: "x", content: c.el, initialFocus: c.first });

    c.last.focus();
    const e1 = tab();
    expect(e1.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c.first);

    const e2 = tab(true);
    expect(e2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c.last); // disabled button skipped

    // mid-cycle Tab is left to the browser (no preventDefault)
    c.mid.focus();
    expect(tab().defaultPrevented).toBe(false);
  });

  it("Shift+Tab with focus outside the overlay pulls it back to the last focusable", () => {
    const GA = makeGA();
    const c = content(GA);
    GA.dialog.open({ label: "x", content: c.el, initialFocus: c.first });

    document.body.focus(); // focus escaped the dialog
    tab(true);
    expect(document.activeElement).toBe(c.last);
  });
});

describe("GA.dialog — close bookkeeping", () => {
  it("restores focus to the opener and fires onClose exactly once (idempotent close)", () => {
    const GA = makeGA();
    const opener = GA.el("button", { text: "open me" });
    document.body.appendChild(opener);
    opener.focus();

    const onClose = vi.fn();
    const c = content(GA);
    const dlg = GA.dialog.open({ label: "x", content: c.el, initialFocus: c.first, onClose });
    expect(document.activeElement).toBe(c.first);

    dlg.close();
    dlg.close(); // second close is a no-op
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dlg.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("skips the focus restore when the opener left the document", () => {
    const GA = makeGA();
    const opener = GA.el("button", { text: "gone" });
    document.body.appendChild(opener);
    opener.focus();

    const dlg = GA.dialog.open({ label: "x", content: content(GA).el });
    opener.remove();
    expect(() => dlg.close()).not.toThrow();
    expect(document.activeElement).not.toBe(opener);
  });

  it("detaches its capture-phase keydown listener on close", () => {
    const GA = makeGA();
    const onEscape = vi.fn(() => false);
    const dlg = GA.dialog.open({ label: "x", content: content(GA).el, onEscape });
    dlg.close();
    escape();
    expect(onEscape).toHaveBeenCalledTimes(0); // listener gone with the dialog
  });
});
