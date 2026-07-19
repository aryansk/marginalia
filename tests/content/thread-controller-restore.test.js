// Restore isolation (T-005): one malformed stored record must not abort
// restoreForSession's loop and hide every other thread's annotations. The bad
// record is skipped (logged via GA.warn) and left INTACT in storage — never
// deleted or re-persisted — so a future load / migration can still see it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Build a controller with recording fakes for everything it touches. The bad
// record throws from GA.selection.highlightThread (the first thing
// restoreThread does), like a malformed/legacy selector would.
function makeController({ throwOnIds = [] } = {}) {
  const GA = loadGA([
    "src/core/live-stream.js",
    "src/core/session-bindings.js",
    "src/content/thread-controller.js",
  ]);

  GA.warn = vi.fn();
  // Empty retry schedule: no post-restore reanchor timers fire against fakes.
  GA.config = { REANCHOR_RETRY_MS: [] };
  GA.store = {
    load: vi.fn(async () => []),
    migrateDraft: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  GA.selection = {
    highlightThread: vi.fn((thread) => {
      if (throwOnIds.includes(thread.id)) throw new Error("malformed record: " + thread.id);
    }),
    anchorEl: vi.fn(() => ({})), // truthy: nothing reads as an orphan
    unhighlight: vi.fn(),
    reanchorAll: vi.fn(),
  };
  GA.gutter = {
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    relayout: vi.fn(),
    scheduleLayout: vi.fn(),
    focusThread: vi.fn(),
    get: vi.fn(),
  };
  GA.ThreadBox = vi.fn(() => ({ focusInput: vi.fn() }));
  return GA;
}

const record = (id) => ({
  id,
  selector: { exact: "quoted text " + id },
  anchor: { role: "model", turn: 1 },
  section: "section",
  messages: [],
  createdAt: 1000,
});

describe("threadController.restoreForSession — per-thread isolation", () => {
  let GA;
  beforeEach(() => {
    GA = makeController({ throwOnIds: ["bad"] });
  });

  it("a record that throws mid-set still restores all the other threads", async () => {
    GA.store.load.mockResolvedValue([record("good1"), record("bad"), record("good2")]);

    await GA.threadController.restoreForSession("gemini:s1");

    const ids = GA.threadController.threads().map((t) => t.id);
    expect(ids).toEqual(["good1", "good2"]);
    expect(GA.gutter.add.mock.calls.map((c) => c[0])).toEqual(["good1", "good2"]);
    // The loop reached every record — the throw didn't short-circuit it.
    expect(GA.selection.highlightThread).toHaveBeenCalledTimes(3);
    // Post-loop relayout still runs.
    expect(GA.gutter.relayout).toHaveBeenCalledTimes(1);
  });

  it("logs the failure via GA.warn with the failing thread's id", async () => {
    GA.store.load.mockResolvedValue([record("bad"), record("good1")]);

    await GA.threadController.restoreForSession("gemini:s1");

    expect(GA.warn).toHaveBeenCalledTimes(1);
    const args = GA.warn.mock.calls[0];
    expect(args).toContain("bad");
    expect(args.some((a) => a instanceof Error)).toBe(true);
  });

  it("never deletes or re-persists the failing record — it stays in storage", async () => {
    GA.store.load.mockResolvedValue([record("good1"), record("bad")]);

    await GA.threadController.restoreForSession("gemini:s1");

    expect(GA.store.remove).not.toHaveBeenCalled();
    expect(GA.store.upsert).not.toHaveBeenCalled();
  });

  it("keeps behavior identical for a well-formed set: all restored, no warns", async () => {
    GA.store.load.mockResolvedValue([record("a"), record("b")]);

    await GA.threadController.restoreForSession("gemini:s1");

    expect(GA.threadController.threads().map((t) => t.id)).toEqual(["a", "b"]);
    expect(GA.warn).not.toHaveBeenCalled();
    expect(GA.gutter.relayout).toHaveBeenCalledTimes(1);
  });
});
