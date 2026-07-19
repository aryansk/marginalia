// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

let GA;
beforeAll(() => {
  GA = loadGA([
    "src/core/sites.js",
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

describe("selection.anchorEl (span registry)", () => {
  it("returns null once the span's subtree is removed from the document (orphan)", () => {
    const root = document.createElement("div");
    root.textContent = "an 8 KB page";
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(root.firstChild, 3);
    range.setEnd(root.firstChild, 7);
    GA.selection.highlightRange(range, "t9");
    expect(GA.selection.anchorEl("t9")).not.toBeNull();

    root.remove(); // the site re-rendered; the span is detached
    expect(GA.selection.anchorEl("t9")).toBeNull();
  });
});

describe("selection.reanchorAll (batch re-anchor)", () => {
  function fixtureAnswer() {
    const root = document.createElement("div");
    root.innerHTML =
      "<p>The default is an 8 KB page for most engines.</p>" +
      "<p>Vacuum reclaims dead tuples over time.</p>";
    document.body.appendChild(root);
    return root;
  }

  it("produces the same spans as sequential highlightSelector calls", () => {
    const threads = [
      { id: "a1", selector: { exact: "8 KB page", prefix: "is an ", suffix: " for most" } },
      { id: "a2", selector: { exact: "dead tuples", prefix: "reclaims ", suffix: " over" } },
      { id: "a3", selector: { exact: "not present anywhere", prefix: "", suffix: "" } },
    ];

    // sequential (the previous per-thread path)
    fixtureAnswer();
    const seq = threads.map((t) =>
      GA.selection.highlightSelector(t.selector, t.id).map((s) => s.textContent),
    );
    threads.forEach((t) => GA.selection.unhighlight(t.id));
    document.body.innerHTML = "";

    // batch
    fixtureAnswer();
    const batch = GA.selection.reanchorAll(threads);
    const batchTexts = threads.map((t) => (batch.get(t.id) || []).map((s) => s.textContent));

    expect(batchTexts).toEqual(seq);
    expect(GA.selection.anchorEl("a1")).not.toBeNull();
    expect(GA.selection.anchorEl("a2")).not.toBeNull();
    expect(GA.selection.anchorEl("a3")).toBeNull(); // stays orphaned
  });

  it("re-anchoring an earlier thread doesn't corrupt later matches in the same pass", () => {
    fixtureAnswer();
    // Both selectors live in the SAME paragraph — wrapping the first splits its
    // text nodes; the second must still resolve from the cached section text.
    const threads = [
      { id: "b1", selector: { exact: "default", prefix: "The ", suffix: " is" } },
      { id: "b2", selector: { exact: "most engines", prefix: "page for ", suffix: "." } },
    ];
    const out = GA.selection.reanchorAll(threads);
    expect(out.get("b1")[0].textContent).toBe("default");
    expect(out.get("b2")[0].textContent).toBe("most engines");
  });
});

describe("selection anchor-name (CSS Anchor Positioning target)", () => {
  function highlight(id) {
    const root = document.createElement("div");
    root.innerHTML = "<span>an 8 KB page</span><span> is the default</span>";
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(root.children[0].firstChild, 3);
    range.setEnd(root.children[1].firstChild, 4); // spans two text nodes -> two spans
    return { root, spans: GA.selection.highlightRange(range, id) };
  }

  it("highlightRange names the first span --ga-<threadId>", () => {
    const { spans } = highlight("t_anchor1");
    expect(spans.length).toBeGreaterThan(1);
    expect(spans[0].style.getPropertyValue("anchor-name")).toBe("--ga-t_anchor1");
    expect(spans[1].style.getPropertyValue("anchor-name")).toBe(""); // only the measured span
  });

  it("ensureAnchorName re-stamps the surviving span after the named one dies", () => {
    const { spans } = highlight("t_anchor2");
    spans[0].remove(); // site re-render killed the named span
    const survivor = GA.selection.anchorEl("t_anchor2");
    expect(survivor).toBe(spans[1]);
    expect(survivor.style.getPropertyValue("anchor-name")).toBe("");
    GA.selection.ensureAnchorName("t_anchor2");
    expect(survivor.style.getPropertyValue("anchor-name")).toBe("--ga-t_anchor2");
  });

  it("ensureAnchorName is a no-op for orphaned or unknown threads", () => {
    expect(() => GA.selection.ensureAnchorName("nope")).not.toThrow();
  });
});
