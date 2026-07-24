// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.LabelStrip in isolation: the shared chips + pill editor mounted by both
// the docked box and the modal. Surface-integration behavior lives in
// thread-labels.dom.test.js (box) and modal.dom.test.js (modal).

function makeGA() {
  return loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/labels.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/ui-bits.js",
    "src/content/label-strip.js",
  ]);
}

afterEach(() => {
  document.body.innerHTML = "";
});

const pressKey = (key) =>
  new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

function mount(GA, thread, opts = {}) {
  const strip = GA.LabelStrip(thread, opts);
  document.body.appendChild(strip.el);
  return strip;
}

const pillTexts = (strip) =>
  Array.from(strip.el.querySelectorAll(".ga-label-pill"), (p) => p.textContent);

describe("GA.LabelStrip — view mode", () => {
  it("renders glyph + pills + pencil for a labeled thread, and fires onChange", () => {
    const GA = makeGA();
    const onChange = vi.fn();
    const strip = mount(GA, { labels: ["a", "b"] }, { onChange });
    strip.render();

    expect(pillTexts(strip)).toEqual(["a", "b"]);
    expect(strip.el.querySelector(".ga-label-glyph")).toBeTruthy();
    expect(strip.el.querySelector(".ga-label-editbtn")).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for an unlabeled thread (the :empty CSS hides it)", () => {
    const GA = makeGA();
    const strip = mount(GA, { labels: [] }, {});
    strip.render();
    expect(strip.el.children).toHaveLength(0);
  });
});

describe("GA.LabelStrip — editor", () => {
  it("edit() shows removable pills and a focused add-input", () => {
    const GA = makeGA();
    const strip = mount(GA, { labels: ["a"] }, {});
    strip.edit();

    expect(strip.el.querySelector(".ga-label-remove")).toBeTruthy();
    const input = strip.el.querySelector(".ga-label-edit");
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("x removes the label, persists, and re-renders", () => {
    const GA = makeGA();
    const persist = vi.fn();
    const thread = { labels: ["a", "b"] };
    const strip = mount(GA, thread, { persist });
    strip.edit();

    strip.el.querySelector(".ga-label-remove").click();
    expect(thread.labels).toEqual(["b"]);
    expect(persist).toHaveBeenCalledWith(thread);
    expect(pillTexts(strip).filter((t) => t.trim() !== "×")).toBeTruthy();
  });

  it("Enter with valid labels routes through onLabel and re-renders the merge", () => {
    const GA = makeGA();
    const thread = { labels: ["a"] };
    const onLabel = vi.fn((t, labels) => {
      t.labels = GA.core.labels.merge(t.labels, labels);
    });
    const strip = mount(GA, thread, { onLabel });
    strip.edit();

    const input = strip.el.querySelector(".ga-label-edit");
    input.value = "b";
    input.dispatchEvent(pressKey("Enter"));
    expect(onLabel).toHaveBeenCalledWith(thread, ["b"]);
    expect(thread.labels).toEqual(["a", "b"]);
  });

  it("an invalid label toasts and keeps the editor open", () => {
    const GA = makeGA();
    const onLabel = vi.fn();
    const strip = mount(GA, { labels: [] }, { onLabel });
    strip.edit();

    const input = strip.el.querySelector(".ga-label-edit");
    input.value = "bad..name";
    input.dispatchEvent(pressKey("Enter"));
    expect(onLabel).not.toHaveBeenCalled();
    expect(document.querySelector(".ga-toast").textContent).toContain("bad..name");
    expect(strip.el.querySelector(".ga-label-edit")).toBeTruthy();
  });

  it("empty Enter exits the editor; Escape exits and does not bubble", () => {
    const GA = makeGA();
    const strip = mount(GA, { labels: ["a"] }, {});
    strip.edit();

    let input = strip.el.querySelector(".ga-label-edit");
    input.value = "  ";
    input.dispatchEvent(pressKey("Enter"));
    expect(strip.el.querySelector(".ga-label-edit")).toBeFalsy();

    strip.edit();
    const escaped = vi.fn();
    document.body.addEventListener("keydown", escaped);
    input = strip.el.querySelector(".ga-label-edit");
    input.dispatchEvent(pressKey("Escape"));
    expect(strip.el.querySelector(".ga-label-edit")).toBeFalsy();
    expect(escaped).not.toHaveBeenCalled(); // stopPropagation — host Esc guards unaffected
  });

  it("skips the re-render after onLabel when isLive() is false (converted surface)", () => {
    const GA = makeGA();
    const thread = { labels: [] };
    const onLabel = vi.fn((t, labels) => {
      t.labels = labels;
    });
    const strip = mount(GA, thread, { onLabel, isLive: () => false });
    strip.edit();

    const input = strip.el.querySelector(".ga-label-edit");
    input.value = "todo";
    input.dispatchEvent(pressKey("Enter"));
    expect(onLabel).toHaveBeenCalled();
    // still showing the (stale) editor — the destroyed surface is never re-rendered
    expect(strip.el.querySelector(".ga-label-edit")).toBeTruthy();
  });
});
