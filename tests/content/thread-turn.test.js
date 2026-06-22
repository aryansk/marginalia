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

  it("does not let a persist failure reject the turn", async () => {
    const { ops } = makeOps(async () => "ok");
    ops.persist = () => {
      throw new Error("storage full");
    };
    await expect(threadTurn.run(thread(), "q", ops)).resolves.toBe("ok");
  });
});
