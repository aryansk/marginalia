// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Panel keyword search (T-003): the all-threads panel gains a search box whose
// query composes with the status tabs. These specs drive the real panel.js
// against stubbed threadController / selection / gutter collaborators.

function makeGA(threads, opts = {}) {
  const GA = loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/core/markdown-ast.js",
    "src/core/thread-search.js",
    "src/core/turn-id.js",
    "src/core/outline.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/ui-bits.js",
    "src/content/dialog.js",
    "src/content/undo-stack.js",
    "src/content/composer.js",
    "src/content/calm-scroll.js",
    "src/content/panel-global.js",
    "src/content/panel.js",
  ]);
  GA.threadController = {
    threads: () => threads,
    expandThreadById: () => {},
  };
  GA.selection = { anchorEl: () => null };
  GA.gutter = { get: () => null, setActive: () => {}, mode: () => "normal" };
  GA.provider = opts.provider || "gemini";
  GA.getSessionId = () => (opts.session === undefined ? "gemini:abc" : opts.session);
  GA.store = { loadConvo: opts.loadConvo || (async () => null) };
  GA.turns = {
    findTurns: () => opts.live || [],
    fingerprintOf: (el) => GA.core.turnId.fingerprint(el.textContent),
    textOf: (el) => el.textContent,
  };
  return GA;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// A mounted turn element the outline can scroll to; scrollIntoView is a
// jsdom no-op, so stub it to observe the jump.
function turnEl(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.scrollIntoView = () => {
    el.scrolled = true;
  };
  return el;
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
function statusSelect() {
  return document.querySelector('[data-filter="status"]');
}
function setStatus(value) {
  const sel = statusSelect();
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
}
function tab(key) {
  return document.querySelector('[data-filter="' + key + '"]');
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
    // switch the status dropdown to Resolved
    setStatus("resolved");
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

// The panel is flex-centered by the overlay, so a 2*delta size change keeps
// the dragged edge under the cursor while the box stays centered — same
// mechanism as the thread modal's width drag, extended to height + corners.
describe("panel drag-resize", () => {
  const drag = (target, from, to) => {
    target.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: from.x, clientY: from.y, bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: to.x, clientY: to.y }));
    document.dispatchEvent(new MouseEvent("mouseup", {}));
  };
  const panelEl = () => document.querySelector(".ga-panel");
  const handle = (cls) => panelEl().querySelector(".ga-modal-resize-" + cls);

  it("edges resize width and height by 2*delta from the config fallbacks", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    drag(handle("right"), { x: 500, y: 0 }, { x: 550, y: 0 });
    expect(panelEl().style.width).toBe("660px"); // 560 + 2*50
    drag(handle("bottom"), { x: 0, y: 500 }, { x: 0, y: 540 });
    expect(panelEl().style.height).toBe("600px"); // 520 + 2*40
    drag(handle("left"), { x: 500, y: 0 }, { x: 480, y: 0 }); // left edge, negative dx grows
    expect(panelEl().style.width).toBe("700px"); // 660 + 2*20
  });

  it("corners drive both axes and clamp to [min, maxFrac*viewport]", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    // jsdom viewport is 1024x768
    drag(handle("br"), { x: 500, y: 500 }, { x: 900, y: 100 });
    expect(panelEl().style.width).toBe(Math.round(1024 * 0.95) + "px"); // max clamp
    expect(panelEl().style.height).toBe("320px"); // min clamp (dragged up = shrink)
    drag(handle("tl"), { x: 500, y: 500 }, { x: 520, y: 520 }); // toward center = shrink
    expect(parseInt(panelEl().style.width, 10)).toBeLessThan(Math.round(1024 * 0.95));
  });

  it("all eight handles exist on the panel", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    ["left", "right", "top", "bottom", "tl", "tr", "bl", "br"].forEach((cls) => {
      expect(handle(cls)).toBeTruthy();
    });
  });

  it("the dragged size is remembered for the session (close -> reopen)", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    drag(handle("right"), { x: 500, y: 0 }, { x: 550, y: 0 });
    drag(handle("bottom"), { x: 0, y: 500 }, { x: 0, y: 540 });
    GA.panel.close();
    GA.panel.open();
    expect(panelEl().style.width).toBe("660px");
    expect(panelEl().style.height).toBe("600px");
  });

  it("mouseup detaches the listeners and clears the resizing state", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    drag(handle("right"), { x: 500, y: 0 }, { x: 550, y: 0 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 900, clientY: 900 }));
    expect(panelEl().style.width).toBe("660px"); // stray move after up: no effect
    expect(
      document.querySelector(".ga-modal-overlay").classList.contains("ga-modal-resizing"),
    ).toBe(false);
  });
});

// The header is (Outline)(▾ status)|(Across chats): the three status views
// collapse into one native select that is itself the threads tab.
describe("panel header: outline + status dropdown", () => {
  it("renders Outline first, then the status select, then Across chats", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    const keys = Array.from(document.querySelectorAll(".ga-panel-tabs [data-filter]")).map(
      (b) => b.dataset.filter,
    );
    expect(keys).toEqual(["outline", "status", "global"]);
    expect(statusSelect().tagName).toBe("SELECT");
    expect(statusSelect().value).toBe("open");
    // chevron is a DOM svg, never a CSS url() image (host CSP can block those)
    expect(document.querySelector(".ga-panel-status-chev svg")).not.toBeNull();
    expect(Array.from(statusSelect().options).map((o) => o.value)).toEqual([
      "open",
      "resolved",
      "all",
    ]);
  });

  it("the select is the active tab for any status view and reflects it after reopen", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    expect(statusSelect().classList.contains("ga-panel-tab-on")).toBe(true);
    setStatus("all");
    expect(rows().length).toBe(3);
    tab("outline").click();
    expect(statusSelect().classList.contains("ga-panel-tab-on")).toBe(false);
    expect(tab("outline").classList.contains("ga-panel-tab-on")).toBe(true);
    // back to the list via the dropdown without changing its value
    statusSelect().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(statusSelect().classList.contains("ga-panel-tab-on")).toBe(true);
    expect(rows().length).toBe(3);
    GA.panel.close();
    GA.panel.open();
    expect(statusSelect().value).toBe("all"); // persisted filter restores the dropdown
    expect(rows().length).toBe(3);
  });

  it("Escape on the focused select closes the dropdown, not the panel", () => {
    const GA = makeGA(THREADS);
    GA.panel.open();
    statusSelect().focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ga-modal-overlay")).not.toBeNull();
  });
});

describe("Outline tab", () => {
  const T = {
    q1: "Explain the Higgs boson to me please",
    a1: "The Higgs boson is an excitation of the Higgs field.",
    q2: "And photosynthesis?",
    a2: "Chlorophyll absorbs light.",
  };
  const fp = (GA, text) => GA.core.turnId.fingerprint(text);
  const stored = (GA) => ({
    turns: [
      { role: "user", fp: fp(GA, T.q1), order: 0, head: T.q1 },
      { role: "model", fp: fp(GA, T.a1), order: 1, head: T.a1 },
      { role: "user", fp: fp(GA, T.q2), order: 2, head: T.q2 },
      { role: "model", fp: fp(GA, T.a2), order: 3, head: T.a2 },
    ],
  });
  const outlineRows = () => document.querySelectorAll(".ga-outline-row");

  async function openOutline(GA) {
    GA.panel.open();
    tab("outline").click();
    await tick();
  }

  it("shows an explicit empty state while the chat has no URL", async () => {
    const GA = makeGA(THREADS, { session: null });
    await openOutline(GA);
    expect(document.querySelector(".ga-modal-empty").textContent).toMatch(
      /once this chat has a URL/,
    );
  });

  it("lists one row per exchange from the stored index, greyed when not mounted", async () => {
    let GA;
    GA = makeGA([], { loadConvo: async () => stored(GA) });
    await openOutline(GA);
    const list = outlineRows();
    expect(list.length).toBe(2);
    expect(list[0].textContent).toContain("You: " + T.q1);
    expect(list[1].textContent).toContain("You: " + T.q2);
    list.forEach((r) => {
      expect(r.classList.contains("ga-outline-unmounted")).toBe(true);
      expect(r.getAttribute("aria-disabled")).toBe("true");
      expect(r.hasAttribute("tabindex")).toBe(false);
      expect(r.textContent).toContain("scroll up to load");
    });
  });

  it("a mounted row is a button that scrolls its turn into view and closes the panel", async () => {
    const q2 = turnEl(T.q2);
    const a2 = turnEl(T.a2);
    let GA;
    GA = makeGA([], {
      loadConvo: async () => stored(GA),
      live: [
        { el: q2, role: "user" },
        { el: a2, role: "model" },
      ],
    });
    await openOutline(GA);
    const list = outlineRows();
    expect(list[0].classList.contains("ga-outline-unmounted")).toBe(true);
    expect(list[1].classList.contains("ga-outline-unmounted")).toBe(false);
    expect(list[1].getAttribute("role")).toBe("button");
    list[1].click();
    expect(q2.scrolled).toBe(true);
    expect(document.querySelector(".ga-modal-overlay")).toBeNull();
  });

  it("works from the live DOM alone when nothing was captured yet", async () => {
    const GA = makeGA([], {
      live: [
        { el: turnEl(T.q1), role: "user" },
        { el: turnEl(T.a1), role: "model" },
      ],
    });
    await openOutline(GA);
    expect(outlineRows().length).toBe(1);
    expect(outlineRows()[0].classList.contains("ga-outline-unmounted")).toBe(false);
  });

  it("nests threads as chips under their exchange; a chip jumps to the thread", async () => {
    const opened = [];
    let GA;
    const threads = [
      {
        id: "on-answer",
        selector: { exact: "Higgs field" },
        anchor: null, // legacy anchor: quote containment places it under a1
        messages: [],
        createdAt: 2,
      },
      {
        id: "on-q2",
        selector: { exact: "photosynthesis" },
        anchor: { v: 2, role: "user", turn: null },
        messages: [],
        createdAt: 1,
      },
      { id: "lost", selector: { exact: "nowhere" }, anchor: null, messages: [], createdAt: 3 },
    ];
    GA = makeGA(threads, { loadConvo: async () => stored(GA) });
    threads[1].anchor.turn = fp(GA, T.q2);
    GA.threadController.expandThreadById = (id) => opened.push(id);
    await openOutline(GA);
    const list = outlineRows();
    expect(list[0].querySelectorAll(".ga-outline-chip").length).toBe(1);
    expect(list[0].querySelector(".ga-outline-chip").textContent).toBe("Higgs field");
    expect(list[1].querySelectorAll(".ga-outline-chip").length).toBe(1);
    // unplaceable threads trail in their own group, rendered as plain rows
    expect(document.querySelector(".ga-panel-group").textContent).toBe("Not on any turn");
    expect(rows().length).toBe(list.length + 1);
    list[0].querySelector(".ga-outline-chip").click();
    expect(opened).toEqual(["on-answer"]); // unanchored in the page → modal, via goToThread
  });

  it("the search box filters rows by prompt text or chip text and counts chips", async () => {
    let GA;
    const threads = [
      {
        id: "c1",
        selector: { exact: "Higgs field" },
        anchor: null,
        messages: [{ role: "user", text: "why?" }],
        createdAt: 1,
      },
    ];
    GA = makeGA(threads, { loadConvo: async () => stored(GA) });
    await openOutline(GA);
    expect(searchInput().placeholder).toBe("Filter outline…");
    type(searchInput(), "photosynthesis"); // matches q2's text only
    expect(outlineRows().length).toBe(1);
    expect(outlineRows()[0].textContent).toContain(T.q2);
    expect(document.querySelector(".ga-panel-count").textContent).toBe("0 of 1");
    type(searchInput(), "why?"); // matches the chip's message only
    expect(outlineRows().length).toBe(1);
    expect(outlineRows()[0].querySelectorAll(".ga-outline-chip").length).toBe(1);
    expect(document.querySelector(".ga-panel-count").textContent).toBe("1 of 1");
    type(searchInput(), "zzz");
    expect(document.querySelector(".ga-modal-empty").textContent).toMatch(
      /nothing in the outline/i,
    );
  });

  it("strips Gemini's screen-reader prefix and truncates long prompts", async () => {
    const long = "You said " + "word ".repeat(40).trim();
    const GA = makeGA([], { live: [{ el: turnEl(long), role: "user" }] });
    await openOutline(GA);
    const text = outlineRows()[0].querySelector(".ga-panel-snippet").textContent;
    expect(text.startsWith("You: word word")).toBe(true);
    expect(text.length).toBe("You: ".length + GA.config.PANEL_OUTLINE_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });

  it("never builds innerHTML from turn text", async () => {
    const GA = makeGA([], { live: [{ el: turnEl("<img src=x onerror=alert(1)>"), role: "user" }] });
    await openOutline(GA);
    const row = outlineRows()[0];
    expect(row.querySelector("img")).toBeNull();
    expect(row.textContent).toContain("<img");
  });
});
