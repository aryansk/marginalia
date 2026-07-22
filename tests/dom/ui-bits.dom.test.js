// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// The shared DOM leaves (ui-bits.js) both box implementations build on:
// confirm popover, orphan toggle, label pill, and the /label intercept head.

function makeGA() {
  return loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/labels.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/ui-bits.js",
  ]);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("GA.confirmPopover", () => {
  it("show/hide toggle visibility; No hides without firing onYes; Yes fires it", () => {
    const GA = makeGA();
    const onYes = vi.fn();
    const confirm = GA.confirmPopover({ prompt: "Delete this thing?", onYes });
    document.body.appendChild(confirm.el);

    expect(confirm.el.textContent).toContain("Delete this thing?");
    expect(confirm.el.classList.contains("ga-confirm-show")).toBe(false);
    confirm.show();
    expect(confirm.el.classList.contains("ga-confirm-show")).toBe(true);

    confirm.el.querySelector(".ga-confirm-no").click();
    expect(confirm.el.classList.contains("ga-confirm-show")).toBe(false);
    expect(onYes).not.toHaveBeenCalled();

    confirm.show();
    confirm.el.querySelector(".ga-confirm-yes").click();
    expect(onYes).toHaveBeenCalledTimes(1);
  });
});

describe("GA.makeOrphanToggle", () => {
  it("inserts/removes the detached badge before the snippet, firing onChange only on transitions", () => {
    const GA = makeGA();
    const snippet = GA.el("div", { class: "ga-box-snippet" });
    const header = GA.el("div", { class: "ga-box-header" }, [snippet]);
    const root = GA.el("div", { class: "ga-box" }, [header]);
    const onChange = vi.fn();
    const setOrphan = GA.makeOrphanToggle({ root, header, snippet, onChange });

    setOrphan(true);
    expect(root.classList.contains("ga-orphan")).toBe(true);
    const badge = root.querySelector(".ga-orphan-badge");
    expect(badge).toBeTruthy();
    expect(badge.nextSibling).toBe(snippet);
    expect(onChange).toHaveBeenCalledTimes(1);

    setOrphan(true); // no transition — badge already there
    expect(onChange).toHaveBeenCalledTimes(1);

    setOrphan(false);
    expect(root.querySelector(".ga-orphan-badge")).toBeFalsy();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("GA.labelPill / GA.labelGlyph / GA.detachedBadge", () => {
  it("plain pill has text only; onRemove adds the × wired to the label", () => {
    const GA = makeGA();
    expect(GA.labelPill("todo").textContent).toBe("todo");
    expect(GA.labelPill("todo").querySelector("button")).toBeFalsy();

    const onRemove = vi.fn();
    const pill = GA.labelPill("todo", { onRemove });
    pill.querySelector(".ga-label-remove").click();
    expect(onRemove).toHaveBeenCalledWith("todo");
  });

  it("glyph visibility follows the on flag; badge carries the caller's class", () => {
    const GA = makeGA();
    expect(GA.labelGlyph().classList.contains("ga-label-glyph-on")).toBe(false);
    expect(GA.labelGlyph({ on: true }).classList.contains("ga-label-glyph-on")).toBe(true);
    expect(GA.detachedBadge().classList.contains("ga-orphan-badge")).toBe(true);
    expect(GA.detachedBadge("ga-panel-badge").classList.contains("ga-panel-badge")).toBe(true);
    expect(GA.detachedBadge("ga-panel-badge").textContent).toBe("detached");
  });
});

describe("GA.tryLabelCommand", () => {
  it("returns false for non-commands, handles errors with a toast, applies via handlers", () => {
    const GA = makeGA();
    const thread = { id: "t", messages: [] };
    const handlers = { onLabel: vi.fn() };
    const onApplied = vi.fn();

    expect(GA.tryLabelCommand("a question", thread, handlers, onApplied)).toBe(false);
    expect(handlers.onLabel).not.toHaveBeenCalled();

    expect(GA.tryLabelCommand("/label bad..name", thread, handlers, onApplied)).toBe(true);
    expect(handlers.onLabel).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(document.querySelector(".ga-toast").textContent).toContain("bad..name");

    expect(GA.tryLabelCommand("/label todo", thread, handlers, onApplied)).toBe(true);
    expect(handlers.onLabel).toHaveBeenCalledWith(thread, ["todo"]);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});
