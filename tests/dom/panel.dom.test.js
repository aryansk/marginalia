// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Panel keyword search (T-003): the all-threads panel gains a search box whose
// query composes with the status tabs. These specs drive the real panel.js
// against stubbed threadController / selection / gutter collaborators.

function makeGA(threads) {
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/core/markdown-ast.js",
    "src/core/thread-search.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/ui-bits.js",
    "src/content/dialog.js",
    "src/content/undo-stack.js",
    "src/content/composer.js",
    "src/content/panel-global.js",
    "src/content/panel.js",
  ]);
  GA.threadController = {
    threads: () => threads,
    expandThreadById: () => {},
  };
  GA.selection = { anchorEl: () => null };
  GA.gutter = { get: () => null, setActive: () => {}, mode: () => "normal" };
  return GA;
}

const THREADS = [
  {
    id: "t1",
    resolved: false,
    selector: { exact: "The Higgs boson" },
    messages: [{ role: "user", text: "Why does it decay?" }],
  },
  {
    id: "t2",
    resolved: false,
    selector: { exact: "Photosynthesis basics" },
    messages: [{ role: "model", text: "Chlorophyll absorbs light." }],
  },
  {
    id: "t3",
    resolved: true,
    selector: { exact: "Higgs field explained" },
    messages: [{ role: "user", text: "What is the field?" }],
  },
];

function rows() {
  return document.querySelectorAll(".ga-panel-row");
}
function searchInput() {
  return document.querySelector(".ga-panel-search-input");
}
function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("panel keyword search", () => {
  it("typing a query reduces the rows to only matching threads", () => {
    const GA = makeGA(THREADS);
    GA.panel.open(); // default filter = open (t1, t2)
    expect(rows().length).toBe(2);

    type(searchInput(), "higgs");
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain("The Higgs boson");
  });

  it("matches AI replies too, not just questions/snippets", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    type(searchInput(), "chlorophyll");
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain("Photosynthesis");
  });

  it("composes with the resolved tab — a matching-but-open thread stays hidden", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    // switch to the Resolved tab
    const resolvedTab = Array.from(document.querySelectorAll(".ga-panel-tab")).find(
      (b) => b.textContent === "Resolved",
    );
    resolvedTab.click();
    type(searchInput(), "higgs");
    // t1 (Higgs, open) is excluded by the tab; only t3 (Higgs field, resolved) shows
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain("Higgs field");
  });

  it("shows a result count and a no-match empty state", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    type(searchInput(), "higgs");
    expect(document.querySelector(".ga-panel-count").textContent).toBe("1 of 2");

    type(searchInput(), "zzz-nothing");
    expect(rows().length).toBe(0);
    expect(document.querySelector(".ga-modal-empty").textContent).toMatch(/no threads match/i);
    expect(document.querySelector(".ga-panel-count").textContent).toBe("0 of 2");
  });

  it("clearing the query (× button) restores the full list", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    type(searchInput(), "higgs");
    expect(rows().length).toBe(1);

    document.querySelector(".ga-panel-search-clear").click();
    expect(searchInput().value).toBe("");
    expect(rows().length).toBe(2);
    expect(document.querySelector(".ga-panel-count").textContent).toBe("");
  });

  it("Escape in a non-empty search box clears the query and keeps the panel open", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    const input = searchInput();
    type(input, "higgs");
    input.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ga-panel-search-input")).not.toBeNull(); // panel still open
    expect(searchInput().value).toBe("");
    expect(rows().length).toBe(2);

    // Escape again (query now empty) closes the panel
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ga-modal-overlay")).toBeNull();
  });

  it("never builds innerHTML from thread/message text", () => {
    const GA = makeGA([
      {
        id: "x",
        resolved: false,
        selector: { exact: "<img src=x onerror=alert(1)>" },
        messages: [{ role: "user", text: "<b>hi</b>" }],
      },
    ]);
    GA.panel.open();
    const row = rows()[0];
    // the malicious markup is rendered as text, not parsed into elements
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("b")).toBeNull();
    expect(row.textContent).toContain("<img");
  });
});
