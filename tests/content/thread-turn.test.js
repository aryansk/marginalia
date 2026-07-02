import { describe, it, expect } from "vitest";
import threadTurn from "../../src/content/thread-turn.js";

// A recording fake of the side-effect `ops` the presenter drives.
function makeOps(askImpl) {
  const calls = [];
  const ops = {
    appendUser: (t) => calls.push(["appendUser", t]),
    beginModel: () => {
      calls.push(["beginModel"]);
      return { rendered: [] };
    },
    renderModel: (h, t) => {
      calls.push(["renderModel", t]);
      h.rendered.push(t);
    },
    endModel: () => calls.push(["endModel"]),
    setLoading: (v) => calls.push(["setLoading", v]),
    persist: () => calls.push(["persist"]),
    ask: askImpl,
  };
  return { ops, calls };
}

const thread = () => ({ selector: { exact: "x" }, section: "", messages: [] });

describe("threadTurn.run", () => {
  it("runs a successful turn: append, stream, persist, return final text", async () => {
    const { ops, calls } = makeOps(async (_t, { onChunk }) => {
      onChunk("Par");
      onChunk("Partial answer.");
      return "Partial answer.";
    });
    const t = thread();
    const result = await threadTurn.run(t, "why?", ops);

    expect(result).toBe("Partial answer.");
    expect(t.messages).toEqual([
      expect.objectContaining({ role: "user", text: "why?" }),
      expect.objectContaining({ role: "model", text: "Partial answer." }),
    ]);
    const names = calls.map((c) => c[0]);
    expect(names).toEqual([
      "appendUser",
      "persist",
      "setLoading", // true
      "beginModel",
      "renderModel", // "Par"
      "renderModel", // "Partial answer."
      "renderModel", // final
      "endModel",
      "setLoading", // false
      "persist",
    ]);
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
  });

  it("renders a ⚠️ message and still resolves when ask rejects", async () => {
    const { ops, calls } = makeOps(async () => {
      throw new Error("network down");
    });
    const t = thread();
    const result = await threadTurn.run(t, "why?", ops);

    expect(result).toContain("network down");
    expect(t.messages[1]).toMatchObject({ role: "model", error: true });
    // loading is always turned off, model message always finalized
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
    expect(calls.some((c) => c[0] === "endModel")).toBe(true);
  });

  it("an aborted turn keeps the partial text as a normal message, no ⚠️", async () => {
    const { ops, calls } = makeOps(async (_t, { onChunk }) => {
      onChunk("partial ans");
      const e = new Error("Cancelled.");
      e.name = "AbortError";
      throw e;
    });
    const t = thread();
    await threadTurn.run(t, "why?", ops);

    expect(t.messages).toEqual([
      expect.objectContaining({ role: "user", text: "why?" }),
      expect.objectContaining({ role: "model", text: "partial ans", stopped: true }),
    ]);
    expect(t.messages[1].error).toBeUndefined();
    // invariants: model finalized, loading off, persisted
    expect(calls.some((c) => c[0] === "endModel")).toBe(true);
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
    expect(calls.filter((c) => c[0] === "persist")).toHaveLength(2);
    // no ⚠️ was rendered
    expect(calls.some((c) => c[0] === "renderModel" && String(c[1]).indexOf("⚠️") === 0)).toBe(false);
  });

  it("an abort before any text arrived records no model message", async () => {
    const { ops } = makeOps(async () => {
      const e = new Error("Cancelled.");
      e.name = "AbortError";
      throw e;
    });
    const t = thread();
    await threadTurn.run(t, "why?", ops);
    expect(t.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("does not let a persist failure reject the turn", async () => {
    const { ops } = makeOps(async () => "ok");
    ops.persist = () => {
      throw new Error("storage full");
    };
    await expect(threadTurn.run(thread(), "q", ops)).resolves.toBe("ok");
  });

  it("prefers ops.renderError for failures and stores the raw message", async () => {
    const { ops, calls } = makeOps(async () => {
      throw new Error("boom");
    });
    ops.renderError = (h, msg) => calls.push(["renderError", msg]);
    const t = thread();
    await threadTurn.run(t, "why?", ops);
    expect(calls.some((c) => c[0] === "renderError" && c[1] === "boom")).toBe(true);
    expect(calls.some((c) => c[0] === "renderModel" && String(c[1]).indexOf("⚠️") === 0)).toBe(false);
    expect(t.messages[1]).toMatchObject({ role: "model", text: "boom", error: true });
  });
});

describe("threadTurn.retry", () => {
  it("drops the trailing error message and re-asks without re-adding the question", async () => {
    const { ops, calls } = makeOps(async (_t, { onChunk }) => {
      onChunk("recovered");
      return "recovered answer";
    });
    const t = thread();
    t.messages.push({ role: "user", text: "why?", ts: 1 });
    t.messages.push({ role: "model", text: "boom", ts: 2, error: true });

    const result = await threadTurn.retry(t, ops);
    expect(result).toBe("recovered answer");
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.messages[1]).toMatchObject({ text: "recovered answer" });
    expect(t.messages[1].error).toBeUndefined();
    expect(calls.filter((c) => c[0] === "appendUser")).toHaveLength(0); // question not duplicated
    expect(calls.filter((c) => c[0] === "setLoading").map((c) => c[1])).toEqual([true, false]);
  });

  it("a failing retry stacks a fresh error message (still recoverable)", async () => {
    const { ops } = makeOps(async () => {
      throw new Error("still down");
    });
    const t = thread();
    t.messages.push({ role: "user", text: "why?", ts: 1 });
    t.messages.push({ role: "model", text: "boom", ts: 2, error: true });
    await threadTurn.retry(t, ops);
    expect(t.messages.map((m) => m.role)).toEqual(["user", "model"]);
    expect(t.messages[1]).toMatchObject({ text: "still down", error: true });
  });
});
