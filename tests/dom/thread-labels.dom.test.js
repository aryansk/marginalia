// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Thread labels in the docked box: the /label composer intercept (a command,
// never an LLM turn), the label section under the header, the pencil editor,
// and the labeled-chip class.

function makeGA() {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/labels.js",
      "src/core/sites.js",
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
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

function submitText(box, text) {
  box.el.querySelector(".ga-input").value = text;
  box.el.querySelector(".ga-send").click();
}

const pillTexts = (box) =>
  Array.from(box.el.querySelectorAll(".ga-thread-labels .ga-label-pill"), (p) => p.textContent);

describe("/label in the box composer", () => {
  it("routes to onLabel and renders the section — the turn machinery never runs", () => {
    const GA = makeGA();
    const runSpy = vi.spyOn(GA.threadTurn, "run");
    const thread = {
      id: "t1",
      selector: { exact: "highlighted text" },
      messages: [{ role: "user", text: "earlier question" }],
    };
    const onLabel = vi.fn((t, labels) => {
      t.labels = GA.core.labels.merge(t.labels, labels); // controller policy
    });
    const box = GA.ThreadBox(thread, { persist: vi.fn(), onLabel });
    document.body.appendChild(box.el);
    expect(box.el.querySelector(".ga-thread-labels").children).toHaveLength(0);

    submitText(box, '/label project.ux "needs review"');

    expect(onLabel).toHaveBeenCalledWith(thread, ["project.ux", "needs review"]);
    expect(runSpy).not.toHaveBeenCalled();
    expect(pillTexts(box)).toEqual(["project.ux", "needs review"]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
    // command text is not a message
    expect(box.el.querySelectorAll(".ga-msg")).toHaveLength(1);
  });

  it("a malformed /label toasts and never reaches onLabel or the LLM", () => {
    const GA = makeGA();
    const runSpy = vi.spyOn(GA.threadTurn, "run");
    const onLabel = vi.fn();
    const box = GA.ThreadBox(
      { id: "t2", selector: { exact: "x" }, messages: [] },
      { persist: vi.fn(), onLabel },
    );
    document.body.appendChild(box.el);

    submitText(box, "/label bad..name");

    expect(onLabel).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".ga-toast").textContent).toContain("bad..name");
  });

  it("survives onLabel destroying the box (empty-thread conversion path)", () => {
    const GA = makeGA();
    const thread = { id: "t3", selector: { exact: "x" }, messages: [] };
    let box;
    const onLabel = vi.fn(() => box.destroy()); // controller swaps surface
    box = GA.ThreadBox(thread, { persist: vi.fn(), onLabel });
    document.body.appendChild(box.el);

    expect(() => submitText(box, "/label todo")).not.toThrow();
    expect(onLabel).toHaveBeenCalledWith(thread, ["todo"]);
    expect(box.el.isConnected).toBe(false);
  });
});

describe("label section rendering + pencil editor", () => {
  it("restored labels render pills; collapsing marks the chip ga-has-labels", () => {
    const GA = makeGA();
    const thread = {
      id: "t4",
      selector: { exact: "x" },
      messages: [],
      labels: ["project.ux"],
    };
    const box = GA.ThreadBox(thread, { persist: vi.fn() });
    document.body.appendChild(box.el);

    expect(pillTexts(box)).toEqual(["project.ux"]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
    expect(box.el.querySelector(".ga-box-header .ga-label-glyph")).toBeTruthy();

    box.setCollapsed(true);
    expect(box.el.classList.contains("ga-collapsed")).toBe(true);
    expect(box.el.classList.contains("ga-has-labels")).toBe(true);
  });

  it("pencil edit rewrites labels in place (quotes for spaced names) and persists", () => {
    const GA = makeGA();
    const persist = vi.fn();
    const thread = {
      id: "t5",
      selector: { exact: "x" },
      messages: [],
      labels: ["needs review", "todo"],
    };
    const box = GA.ThreadBox(thread, { persist });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-label-editbtn").click();
    const input = box.el.querySelector(".ga-label-edit");
    expect(input.value).toBe('"needs review" todo');

    input.value = "project.ux DONE";
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(thread.labels).toEqual(["project.ux", "done"]);
    expect(persist).toHaveBeenCalledWith(thread);
    expect(pillTexts(box)).toEqual(["project.ux", "done"]);
  });

  it("Escape cancels the edit without persisting; invalid input keeps the editor open", () => {
    const GA = makeGA();
    const persist = vi.fn();
    const thread = { id: "t6", selector: { exact: "x" }, messages: [], labels: ["keep"] };
    const box = GA.ThreadBox(thread, { persist });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-label-editbtn").click();
    let input = box.el.querySelector(".ga-label-edit");
    input.value = "bad..name";
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(thread.labels).toEqual(["keep"]); // rejected — nothing committed
    expect(box.el.querySelector(".ga-label-edit")).toBeTruthy(); // still editing

    input = box.el.querySelector(".ga-label-edit");
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(box.el.querySelector(".ga-label-edit")).toBeFalsy();
    expect(persist).not.toHaveBeenCalled();
    expect(pillTexts(box)).toEqual(["keep"]);
  });

  it("clearing the editor removes all labels and the chip marker", () => {
    const GA = makeGA();
    const thread = { id: "t7", selector: { exact: "x" }, messages: [], labels: ["a", "b"] };
    const box = GA.ThreadBox(thread, { persist: vi.fn() });
    document.body.appendChild(box.el);

    box.el.querySelector(".ga-label-editbtn").click();
    const input = box.el.querySelector(".ga-label-edit");
    input.value = "";
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(thread.labels).toEqual([]);
    expect(box.el.classList.contains("ga-has-labels")).toBe(false);
    expect(pillTexts(box)).toEqual([]);
  });
});
