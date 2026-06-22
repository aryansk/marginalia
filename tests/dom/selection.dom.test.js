// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

let GA;
beforeAll(() => {
  GA = loadGA([
    "src/core/anchor-match.js",
    "src/content/anchor.js",
    "src/content/selection.js",
  ]);
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("selection.highlightRange", () => {
  it("wraps a single-text-node range in one highlight span", () => {
    const root = document.createElement("div");
    root.textContent = "an 8 KB page";
    document.body.appendChild(root);

    const range = document.createRange();
    range.setStart(root.firstChild, 3);
    range.setEnd(root.firstChild, 7); // "8 KB"

    const spans = GA.selection.highlightRange(range, "t1");
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("8 KB");
    expect(spans[0].className).toBe("ga-highlight");
    expect(GA.selection.anchorEl("t1")).toBe(spans[0]);
    expect(root.textContent).toBe("an 8 KB page"); // surrounding text intact
  });

  it("wraps a range that spans multiple text nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>foo </span><span>bar baz</span>";
    document.body.appendChild(root);

    const range = document.createRange();
    range.setStart(root.children[0].firstChild, 2); // "o "
    range.setEnd(root.children[1].firstChild, 3); // "bar"

    const spans = GA.selection.highlightRange(range, "m1");
    expect(spans.length).toBe(2);
    expect(spans.map((s) => s.textContent).join("")).toBe("o bar");
  });
});

describe("selection.unhighlight", () => {
  it("removes the spans and restores the original text", () => {
    const root = document.createElement("div");
    root.textContent = "an 8 KB page";
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(root.firstChild, 3);
    range.setEnd(root.firstChild, 7);
    GA.selection.highlightRange(range, "t1");

    GA.selection.unhighlight("t1");
    expect(document.querySelector(".ga-highlight")).toBeNull();
    expect(GA.selection.anchorEl("t1")).toBeNull();
    expect(root.textContent).toBe("an 8 KB page");
  });
});
