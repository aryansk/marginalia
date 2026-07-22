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
      "src/content/markdown.js",
      "src/content/thread-turn.js",
      "src/content/stream-view.js",
      "src/content/undo-stack.js",
      "src/content/composer.js",
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
