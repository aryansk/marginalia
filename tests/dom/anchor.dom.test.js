// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

let GA;
beforeAll(() => {
  GA = loadGA(["src/core/anchor-match.js", "src/content/anchor.js"]);
});
afterEach(() => {
  document.body.innerHTML = "";
});

function fixture(text) {
  const root = document.createElement("div");
  root.textContent = text;
  document.body.appendChild(root);
  return root;
}

// Select [start,end) within root's first text node.
function selectRange(root, start, end) {
  const range = document.createRange();
  range.setStart(root.firstChild, start);
  range.setEnd(root.firstChild, end);
  return range;
}

describe("anchor.fromRange", () => {
  it("captures exact + surrounding prefix/suffix", () => {
    const root = fixture("The 8 KB page size matters here");
    const sel = GA.anchor.fromRange(selectRange(root, 4, 8), root); // "8 KB"
    expect(sel.exact).toBe("8 KB");
    expect(sel.prefix).toBe("The ");
    expect(sel.suffix.startsWith(" page")).toBe(true);
  });
});

describe("anchor.locate (round-trip)", () => {
  it("re-finds the exact range from a selector", () => {
    const root = fixture("The 8 KB page size matters here");
    const sel = GA.anchor.fromRange(selectRange(root, 4, 8), root);
    const range = GA.anchor.locate(sel, root);
    expect(range.toString()).toBe("8 KB");
  });

  it("returns null when the text is absent", () => {
    const root = fixture("nothing relevant here");
    expect(GA.anchor.locate({ exact: "8 KB" }, root)).toBeNull();
  });

  it("ignores text inside our own UI (.ga-gutter)", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="ga-gutter">8 KB</div><p>real 8 KB answer</p>';
    document.body.appendChild(root);
    const range = GA.anchor.locate({ exact: "8 KB", prefix: "real ", suffix: " answer" }, root);
    // the match must be inside the <p>, not the gutter copy
    expect(range.toString()).toBe("8 KB");
    expect(range.startContainer.parentElement.closest(".ga-gutter")).toBeNull();
  });
});
