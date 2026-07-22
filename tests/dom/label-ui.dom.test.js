// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// The standalone label chip (kind:"label" records): compact-only surface,
// in-place editor (add/remove/delete), and the gutter box interface no-ops.

function makeGA() {
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/labels.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/label-ui.js",
  ]);
  GA.selection = { setHighlightHover: vi.fn() };
  return GA;
}

afterEach(() => {
  document.body.innerHTML = "";
});

const makeRecord = (labels = ["project.ux"]) => ({
  id: "l1",
  kind: "label",
  selector: { exact: "the highlighted turn text" },
  messages: [],
  labels,
});

const makeHandlers = () => ({
  persist: vi.fn(),
  onDelete: vi.fn(),
  onFocus: vi.fn(),
  onResize: vi.fn(),
});

const pillTexts = (chip) =>
  Array.from(chip.el.querySelectorAll(".ga-label-editor-pills .ga-label-pill"), (p) =>
    p.textContent.trim(),
  );

describe("GA.LabelChip", () => {
  it("renders as a permanently-compact tag chip with the snippet", () => {
    const GA = makeGA();
    const chip = GA.LabelChip(makeRecord(), makeHandlers());
    document.body.appendChild(chip.el);

    expect(chip.el.classList.contains("ga-label-chip")).toBe(true);
    expect(chip.el.classList.contains("ga-collapsed")).toBe(true);
    expect(chip.el.querySelector(".ga-label-glyph svg")).toBeTruthy();
    expect(chip.el.querySelector(".ga-box-snippet").textContent).toContain("highlighted turn");
    expect(chip.isCompact()).toBe(true);
    // gutter-interface no-ops must not throw or change compactness
    expect(() => {
      chip.setCollapsed(false);
      chip.setMaxHeight(100);
    }).not.toThrow();
    expect(chip.isCompact()).toBe(true);
  });

  it("shows a count pill only for multi-label records", () => {
    const GA = makeGA();
    const one = GA.LabelChip(makeRecord(["a"]), makeHandlers());
    const three = GA.LabelChip(makeRecord(["a", "b", "c"]), makeHandlers());
    expect(one.el.querySelector(".ga-chip-count").textContent).toBe("");
    expect(three.el.querySelector(".ga-chip-count").textContent).toBe("3");
  });

  it("header click opens the editor; adding labels merges + persists", () => {
    const GA = makeGA();
    const record = makeRecord(["project.ux"]);
    const handlers = makeHandlers();
    const chip = GA.LabelChip(record, handlers);
    document.body.appendChild(chip.el);

    chip.el.querySelector(".ga-box-header").click();
    expect(chip.el.classList.contains("ga-label-editing")).toBe(true);
    expect(pillTexts(chip)).toEqual(["project.ux"]);

    const input = chip.el.querySelector(".ga-label-edit");
    input.value = 'todo "needs review"';
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(record.labels).toEqual(["project.ux", "todo", "needs review"]);
    expect(handlers.persist).toHaveBeenCalledWith(record);
    expect(pillTexts(chip)).toEqual(["project.ux", "todo", "needs review"]);
  });

  it("invalid additions toast and change nothing", () => {
    const GA = makeGA();
    const record = makeRecord(["keep"]);
    const handlers = makeHandlers();
    const chip = GA.LabelChip(record, handlers);
    document.body.appendChild(chip.el);

    chip.el.querySelector(".ga-box-header").click();
    const input = chip.el.querySelector(".ga-label-edit");
    input.value = ".bad";
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(record.labels).toEqual(["keep"]);
    expect(handlers.persist).not.toHaveBeenCalled();
    expect(document.querySelector(".ga-toast").textContent).toContain(".bad");
  });

  it("the pill × removes one label and persists", () => {
    const GA = makeGA();
    const record = makeRecord(["a", "b"]);
    const handlers = makeHandlers();
    const chip = GA.LabelChip(record, handlers);
    document.body.appendChild(chip.el);

    chip.el.querySelector(".ga-box-header").click();
    chip.el.querySelector(".ga-label-remove").click();

    expect(record.labels).toEqual(["b"]);
    expect(handlers.persist).toHaveBeenCalledWith(record);
    expect(pillTexts(chip)).toEqual(["b"]);
  });

  it("delete goes through the confirm: trash shows it, Yes fires onDelete", () => {
    const GA = makeGA();
    const record = makeRecord();
    const handlers = makeHandlers();
    const chip = GA.LabelChip(record, handlers);
    document.body.appendChild(chip.el);

    chip.el.querySelector(".ga-box-header").click();
    chip.el.querySelector('.ga-iconbtn[title^="Delete"]').click();
    expect(chip.el.querySelector(".ga-confirm").classList.contains("ga-confirm-show")).toBe(true);
    expect(handlers.onDelete).not.toHaveBeenCalled();

    chip.el.querySelector(".ga-confirm-yes").click();
    expect(handlers.onDelete).toHaveBeenCalledWith(record);
  });

  it("setOrphan toggles the detached badge; destroy removes the chip", () => {
    const GA = makeGA();
    const chip = GA.LabelChip(makeRecord(), makeHandlers());
    document.body.appendChild(chip.el);

    chip.setOrphan(true);
    expect(chip.el.querySelector(".ga-orphan-badge")).toBeTruthy();
    chip.setOrphan(false);
    expect(chip.el.querySelector(".ga-orphan-badge")).toBeFalsy();

    chip.destroy();
    expect(chip.el.isConnected).toBe(false);
  });
});
