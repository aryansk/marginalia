// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// A destroyed box (torn down on conversation switch) must ignore late work from
// a still-running turn: no renders into detached nodes, no relayout requests,
// and no throws. (The turn itself keeps running — session pinning decides where
// it persists; this is only about the dead view.)

function makeGA() {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/labels.js",
      "src/core/markdown-ast.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/ui-bits.js",
      "src/content/markdown.js",
      "src/content/thread-turn.js",
      "src/content/stream-view.js",
      "src/content/undo-stack.js",
      "src/content/composer.js",
      "src/content/label-strip.js",
      "src/content/calm-scroll.js",
      "src/content/thread-ui.js",
    ],
    {
      // Deterministic sync animation frames for the streaming coalescer.
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ThreadBox.destroy()", () => {
  it("late stream chunks and completion no longer touch the box", async () => {
    const GA = makeGA();
    let resolveAsk;
    let onChunk;
    let resizes = 0;
    const thread = { id: "t1", selector: { exact: "highlighted text" }, messages: [] };
    const box = GA.ThreadBox(thread, {
      ask: (t, opts) =>
        new Promise((res) => {
          resolveAsk = res;
          onChunk = opts.onChunk;
        }),
      persist: () => {},
      onResize: () => resizes++,
    });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-input").value = "why?";
    box.el.querySelector(".ga-send").click();
    await tick(); // let the turn reach ask()

    onChunk("partial");
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(2); // user + model
    expect(box.el.querySelectorAll(".ga-msg")[1].textContent).toContain("partial");

    box.destroy();
    const resizesAtDestroy = resizes;

    expect(() => onChunk("partial plus more")).not.toThrow();
    resolveAsk("final answer");
    await tick(); // turn finishes (endModel, setLoading(false), persist)

    const model = box.el.querySelectorAll(".ga-msg")[1];
    expect(model.textContent).not.toContain("final"); // no render after destroy
    expect(box.el.classList.contains("ga-msg-streaming")).toBe(false);
    expect(resizes).toBe(resizesAtDestroy); // no relayout churn from the dead box
    expect(thread.messages.map((m) => m.role)).toEqual(["user", "model"]); // turn itself completed
  });

  it("Ctrl+Z restores the inline composer text after send; Ctrl+Shift+Z re-clears", () => {
    const GA = makeGA();
    const thread = { id: "tu", selector: { exact: "x" }, messages: [] };
    const box = GA.ThreadBox(thread, {
      ask: () => new Promise(() => {}), // never resolves — we only care about the clear
      persist: () => {},
    });
    document.body.appendChild(box.el);
    const ta = box.el.querySelector(".ga-input");

    ta.value = "bring me back";
    box.el.querySelector(".ga-send").click(); // submit clears the box
    expect(ta.value).toBe("");

    const e1 = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e1);
    expect(ta.value).toBe("bring me back");
    expect(e1.defaultPrevented).toBe(true);

    const e2 = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e2);
    expect(ta.value).toBe("");
  });

  it("Ctrl+Z on an empty inline composer stack does not preventDefault", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "te", selector: { exact: "x" }, messages: [] },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const ta = box.el.querySelector(".ga-input");
    const e = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("appendMessage on a destroyed box returns a handle without attaching it", () => {
    const GA = makeGA();
    const thread = { id: "t2", selector: { exact: "x" }, messages: [] };
    const box = GA.ThreadBox(thread, { persist: () => {} });
    document.body.appendChild(box.el);
    box.destroy();
    expect(box.el.isConnected).toBe(false);
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(0);
  });
});

describe("draft handoff while collapsed", () => {
  it("takeDraft on a collapsed box never pins the textarea to 0px", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "h1", selector: { exact: "x" }, messages: [] },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const ta = box.el.querySelector(".ga-input");
    ta.style.height = "40px"; // a previously-fitted height

    // The wasCompact expand path: the composer is display:none when the
    // draft is taken, so fitTextarea measures scrollHeight 0 — the guard
    // must keep the prior height instead of writing 0px.
    box.setCollapsed(true, { persist: false });
    box.takeDraft();
    box.setCollapsed(false, { persist: false });
    expect(ta.style.height).toBe("40px");
  });
});

describe("height measurement (naturalHeight / chromeHeight)", () => {
  it("serves both values from one cached pass; invalidateHeight refreshes", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "m1", selector: { exact: "x" }, messages: [] },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    let offsetH = 300;
    let clientH = 150;
    let scrollH = 500;
    Object.defineProperty(box.el, "offsetHeight", { get: () => offsetH, configurable: true });
    Object.defineProperty(messagesEl, "clientHeight", { get: () => clientH, configurable: true });
    Object.defineProperty(messagesEl, "scrollHeight", { get: () => scrollH, configurable: true });
    box.invalidateHeight();

    expect(box.chromeHeight()).toBe(150); // offsetHeight - clientHeight
    expect(box.naturalHeight()).toBe(650); // chrome + scrollHeight

    // same cache: geometry changes are invisible until invalidated
    offsetH = 340; // composer grew 40px
    expect(box.chromeHeight()).toBe(150);
    expect(box.naturalHeight()).toBe(650);

    box.invalidateHeight();
    expect(box.chromeHeight()).toBe(190);
    expect(box.naturalHeight()).toBe(690);
  });
});

describe("lazy history rendering", () => {
  afterEach(() => {
    delete window.requestIdleCallback;
  });
  const messages = (n) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 ? "model" : "user",
      text: "message " + i,
    }));

  it("a collapsed chip builds no message DOM until expanded, then shows everything", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "l1", selector: { exact: "x" }, messages: messages(6), collapsed: true },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    box.naturalHeight(); // chip measurement — must NOT materialize history
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(0);

    box.setCollapsed(false, { persist: false });
    const texts = Array.from(box.el.querySelectorAll(".ga-msg"), (m) => m.textContent);
    expect(texts).toEqual(messages(6).map((m) => m.text)); // full history, in order
  });

  it("an expanded box materializes at first measure; jsdom (zero heights) renders fully", () => {
    const GA = makeGA();
    const box = GA.ThreadBox(
      { id: "l2", selector: { exact: "x" }, messages: messages(4) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(0); // constructor defers
    box.naturalHeight();
    expect(Array.from(box.el.querySelectorAll(".ga-msg"), (m) => m.textContent)).toEqual(
      messages(4).map((m) => m.text),
    );
  });

  it("stops at the viewport target and idle-fills the rest, oldest last, order intact", () => {
    const GA = makeGA();
    const idle = [];
    window.requestIdleCallback = (cb) => (idle.push(cb), idle.length);
    const box = GA.ThreadBox(
      { id: "l3", selector: { exact: "x" }, messages: messages(10) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    // grow scrollHeight with each rendered message so the sync loop stops
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => messagesEl.querySelectorAll(".ga-msg").length * 300,
      configurable: true,
    });
    box.naturalHeight(); // 3 messages reach the 768px jsdom viewport target
    expect(messagesEl.querySelectorAll(".ga-msg")).toHaveLength(3);

    while (idle.length) idle.shift()(); // run idle batches
    expect(Array.from(messagesEl.querySelectorAll(".ga-msg"), (m) => m.textContent)).toEqual(
      messages(10).map((m) => m.text),
    ); // complete, correct order
  });

  it("scrolling near the top flushes the pending history synchronously", () => {
    const GA = makeGA();
    const idle = [];
    window.requestIdleCallback = (cb) => (idle.push(cb), idle.length);
    const box = GA.ThreadBox(
      { id: "l4", selector: { exact: "x" }, messages: messages(10) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => messagesEl.querySelectorAll(".ga-msg").length * 300,
      configurable: true,
    });
    box.naturalHeight();
    expect(messagesEl.querySelectorAll(".ga-msg").length).toBeLessThan(10);

    messagesEl.scrollTop = 0;
    messagesEl.dispatchEvent(new window.Event("scroll"));
    expect(messagesEl.querySelectorAll(".ga-msg")).toHaveLength(10); // flushed
  });

  it("refreshMessages resets the pending fill (no duplicates)", () => {
    const GA = makeGA();
    const idle = [];
    window.requestIdleCallback = (cb) => (idle.push(cb), idle.length);
    const box = GA.ThreadBox(
      { id: "l5", selector: { exact: "x" }, messages: messages(8) },
      { persist: () => {} },
    );
    document.body.appendChild(box.el);
    const messagesEl = box.el.querySelector(".ga-messages");
    Object.defineProperty(messagesEl, "scrollHeight", {
      get: () => messagesEl.querySelectorAll(".ga-msg").length * 300,
      configurable: true,
    });
    box.naturalHeight(); // partial render, idle pending
    box.refreshMessages(); // full eager rebuild
    while (idle.length) idle.shift()(); // stale idle batches must be no-ops
    expect(messagesEl.querySelectorAll(".ga-msg")).toHaveLength(8);
  });
});
