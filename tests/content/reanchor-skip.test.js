// The controller's re-anchor pass: futile-retry skip (locating is
// deterministic in turn elements + turn text + orphan set — an unchanged
// triple after a failed pass must not rescan the conversation every mutation
// frame) and the connectivity-first orphan probe with its throttled rect
// sweep.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

function makeController() {
  const GA = loadGA([
    "src/core/sites.js",
    "src/core/prompt.js",
    "src/core/live-stream.js",
    "src/core/session-bindings.js",
    "src/content/ask-flow.js",
    "src/content/thread-controller.js",
  ]);
  GA.warn = vi.fn();
  GA.config = { REANCHOR_RETRY_MS: [] };
  GA.provider = "chatgpt";
  GA.settings = { scope: "section" };
  GA.getSessionId = () => "chatgpt:s1";
  GA.store = {
    load: vi.fn(async () => []),
    migrateDraft: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  GA.selection = {
    highlightThread: vi.fn(() => []),
    anchorEl: vi.fn(() => null),
    hasLiveSpan: vi.fn(() => false),
    unhighlight: vi.fn(),
    reanchorAll: vi.fn(() => new Map()),
  };
  GA.turns = { findTurns: vi.fn(() => []) };
  GA.gutter = {
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    relayout: vi.fn(),
    scheduleLayout: vi.fn(),
    focusThread: vi.fn(),
    get: vi.fn(),
  };
  GA.Modal = { open: vi.fn(), close: vi.fn() };
  GA.ThreadBox = vi.fn(() => ({ focusInput: vi.fn() }));
  GA.askService = { ask: vi.fn() };
  return GA;
}

const record = (id) => ({
  id,
  selector: { exact: "quoted " + id },
  anchor: { role: "model", turn: 1 },
  section: "section text",
  messages: [],
  createdAt: 1000,
});

async function restoreThreads(GA, ids) {
  GA.store.load.mockResolvedValue(ids.map(record));
  await GA.threadController.restoreForSession("chatgpt:s1");
}

const turnsOf = (...els) => els.map((el) => ({ el, role: "model" }));

describe("reanchorOrphans — futile-retry skip", () => {
  let GA;
  const elA = { id: "turnA" };
  const elB = { id: "turnB" };
  beforeEach(async () => {
    GA = makeController();
    await restoreThreads(GA, ["t1"]);
    GA.selection.reanchorAll.mockClear();
    GA.turns.findTurns.mockReturnValue(turnsOf(elA, elB));
  });

  it("skips the rescan when turns, text, and orphan set are all unchanged", () => {
    GA.threadController.reanchorOrphans({ textChanged: false }); // fails (empty results)
    expect(GA.selection.reanchorAll).toHaveBeenCalledTimes(1);
    GA.threadController.reanchorOrphans({ textChanged: false });
    expect(GA.selection.reanchorAll).toHaveBeenCalledTimes(1); // skipped
    expect(GA.gutter.scheduleLayout).toHaveBeenCalled(); // layout still runs
  });

  it("re-attempts when turn text changed", () => {
    GA.threadController.reanchorOrphans({ textChanged: false });
    GA.threadController.reanchorOrphans({ textChanged: true });
    expect(GA.selection.reanchorAll).toHaveBeenCalledTimes(2);
  });

  it("re-attempts when the turn element set changed", () => {
    GA.threadController.reanchorOrphans({ textChanged: false });
    GA.turns.findTurns.mockReturnValue(turnsOf(elA, elB, { id: "turnC" }));
    GA.threadController.reanchorOrphans({ textChanged: false });
    expect(GA.selection.reanchorAll).toHaveBeenCalledTimes(2);
  });

  it("hint-less calls (retry timers, restore) always attempt", () => {
    GA.threadController.reanchorOrphans({ textChanged: false });
    GA.threadController.reanchorOrphans();
    expect(GA.selection.reanchorAll).toHaveBeenCalledTimes(2);
  });

  it("a successful pass clears the futile signature", () => {
    GA.threadController.reanchorOrphans({ textChanged: false }); // fail #1
    GA.selection.reanchorAll.mockReturnValue(new Map([["t1", [{}]]]));
    GA.threadController.reanchorOrphans({ textChanged: true }); // succeeds
    GA.selection.anchorEl.mockReturnValue(null); // orphaned again later
    GA.selection.reanchorAll.mockReturnValue(new Map());
    GA.threadController.reanchorOrphans({ textChanged: false }); // must attempt
    expect(GA.selection.reanchorAll).toHaveBeenCalledTimes(3);
  });

  it("shares one findTurns with the batch pass (passed into reanchorAll)", () => {
    GA.threadController.reanchorOrphans({ textChanged: true });
    expect(GA.turns.findTurns).toHaveBeenCalledTimes(1);
    expect(GA.selection.reanchorAll).toHaveBeenCalledWith(expect.any(Array), turnsOf(elA, elB));
  });
});

describe("hasOrphans — connectivity-first probe with throttled rect sweep", () => {
  it("disconnected span: cheap path answers true with no rect sweep", async () => {
    const GA = makeController();
    await restoreThreads(GA, ["t1"]);
    GA.selection.hasLiveSpan.mockReturnValue(false);
    GA.selection.anchorEl.mockClear();
    expect(GA.threadController.hasOrphans()).toBe(true);
    expect(GA.selection.anchorEl).not.toHaveBeenCalled();
  });

  it("connected spans: the rect sweep runs at most once per throttle window", async () => {
    const GA = makeController();
    await restoreThreads(GA, ["t1"]);
    GA.selection.hasLiveSpan.mockReturnValue(true);
    GA.selection.anchorEl.mockReturnValue(null); // hidden (zero-rect) span
    const origNow = performance.now.bind(performance);
    let offset = 0;
    vi.spyOn(performance, "now").mockImplementation(() => origNow() + offset);

    expect(GA.threadController.hasOrphans()).toBe(true); // sweep ran
    GA.selection.anchorEl.mockClear();
    expect(GA.threadController.hasOrphans()).toBe(false); // throttled
    expect(GA.selection.anchorEl).not.toHaveBeenCalled();
    offset = 300; // past the window
    expect(GA.threadController.hasOrphans()).toBe(true); // sweep again
    vi.restoreAllMocks();
  });
});
