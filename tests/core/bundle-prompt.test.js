import { describe, it, expect, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/core/turn-id.js", "src/core/compress.js", "src/core/bundle-prompt.js"]);
const { resolveTurn, resolveFromDecoded, resolveText, threadContent, compose, downloadDoc } =
  GA.core.bundlePrompt;
const { fingerprint } = GA.core.turnId;
const { gzipToB64 } = GA.core.compress;

const TURN_TEXT = "The Higgs boson decays quickly because its coupling is large.";

async function makeRawConvo() {
  const fp = fingerprint(TURN_TEXT);
  return {
    v: 1,
    title: "Physics chat",
    turns: [
      { role: "user", fp: fingerprint("why?"), order: 0 },
      { role: "model", fp, order: 1 },
    ],
    blobs: {
      [fp.hash + ":" + fp.len]: await gzipToB64(TURN_TEXT),
      [fingerprint("why?").hash + ":" + fingerprint("why?").len]: await gzipToB64("why?"),
    },
  };
}

const labelRecord = (over = {}) => ({
  id: "l1",
  kind: "label",
  selector: { exact: "coupling is large" },
  anchor: { v: 2, role: "model", turn: fingerprint(TURN_TEXT) },
  labels: ["physics"],
  messages: [],
  ...over,
});

describe("bundlePrompt.resolveTurn (selective decode)", () => {
  it("inflates exactly the fingerprint-addressed blob", async () => {
    const raw = await makeRawConvo();
    await expect(resolveTurn(raw, labelRecord())).resolves.toBe(TURN_TEXT);
  });

  it("returns null (never throws) on fp miss, missing blob, corrupt blob, or no record", async () => {
    const raw = await makeRawConvo();
    const stale = labelRecord({ anchor: { role: "model", turn: fingerprint("other text") } });
    await expect(resolveTurn(raw, stale)).resolves.toBe(null);

    const fp = fingerprint(TURN_TEXT);
    const noBlob = { ...raw, blobs: {} };
    await expect(resolveTurn(noBlob, labelRecord())).resolves.toBe(null);

    const corrupt = { ...raw, blobs: { [fp.hash + ":" + fp.len]: "%%%not-base64%%%" } };
    await expect(resolveTurn(corrupt, labelRecord())).resolves.toBe(null);

    await expect(resolveTurn(null, labelRecord())).resolves.toBe(null);
    await expect(resolveTurn(raw, { selector: { exact: "x" } })).resolves.toBe(null);
  });
});

describe("bundlePrompt.resolveFromDecoded (fallback)", () => {
  const decoded = [
    { role: "user", fp: fingerprint("why?"), text: "why?" },
    { role: "model", fp: fingerprint(TURN_TEXT), text: TURN_TEXT },
  ];

  it("matches by fingerprint first", () => {
    expect(resolveFromDecoded(decoded, labelRecord())).toBe(TURN_TEXT);
  });

  it("falls back to same-role quote containment when the fingerprint misses", () => {
    const stale = labelRecord({ anchor: { role: "model", turn: fingerprint("regenerated") } });
    expect(resolveFromDecoded(decoded, stale)).toBe(TURN_TEXT);
    // the quote also appears nowhere → null
    const gone = labelRecord({
      anchor: { role: "model", turn: fingerprint("regenerated") },
      selector: { exact: "text that exists in no turn" },
    });
    expect(resolveFromDecoded(decoded, gone)).toBe(null);
  });

  it("is null-safe", () => {
    expect(resolveFromDecoded(null, labelRecord())).toBe(null);
    expect(resolveFromDecoded([], labelRecord())).toBe(null);
  });
});

describe("bundlePrompt.resolveText (the full ladder)", () => {
  it("tier 1: selective decode wins without ever calling the decoded thunk", async () => {
    const raw = await makeRawConvo();
    const getDecoded = vi.fn();
    await expect(resolveText(raw, getDecoded, labelRecord())).resolves.toBe(TURN_TEXT);
    expect(getDecoded).not.toHaveBeenCalled();
  });

  it("tier 2: fingerprint miss falls back to the lazily-decoded conversation", async () => {
    const stale = labelRecord({ anchor: { role: "model", turn: fingerprint("regenerated") } });
    const getDecoded = vi.fn(async () => ({
      turns: [{ role: "model", fp: fingerprint(TURN_TEXT), text: TURN_TEXT }],
    }));
    await expect(resolveText(null, getDecoded, stale)).resolves.toBe(TURN_TEXT);
    expect(getDecoded).toHaveBeenCalledTimes(1);
  });

  it("tier 3: every miss floors to section text, then the quote, then empty", async () => {
    const gone = labelRecord({
      anchor: null,
      section: "the stored section",
      selector: { exact: "the quote" },
    });
    await expect(resolveText(null, async () => null, gone)).resolves.toBe("the stored section");
    delete gone.section;
    await expect(resolveText(null, async () => null, gone)).resolves.toBe("the quote");
    await expect(resolveText(null, async () => null, {})).resolves.toBe("");
  });
});

describe("bundlePrompt.threadContent / compose", () => {
  it("renders the discussion in Me:/You: convention, skipping error notices", () => {
    const t = {
      messages: [
        { role: "user", text: "what is this?" },
        { role: "model", text: "an explanation" },
        { role: "model", text: "request failed", error: true },
      ],
    };
    expect(threadContent(t)).toBe("Me: what is this?\nYou: an explanation");
  });

  it("compose bundles items with provenance and ends with the instruction", () => {
    const prompt = compose({
      instruction: "extract common patterns",
      providerLabel: "Gemini",
      items: [
        {
          kind: "turn",
          title: "Physics chat",
          labels: ["physics"],
          content: TURN_TEXT,
        },
        {
          kind: "thread",
          title: "CSS chat",
          snippet: "anchor positioning",
          content: "Me: why?\nYou: because",
        },
      ],
    });
    expect(prompt).toContain("2 excerpts");
    expect(prompt).toContain("you (Gemini)");
    expect(prompt).toContain("--- Item 1 ---");
    expect(prompt).toContain("Conversation: Physics chat");
    expect(prompt).toContain("Labels: physics");
    expect(prompt).toContain("Labeled answer:");
    expect(prompt).toContain(TURN_TEXT);
    expect(prompt).toContain('Highlighted: "anchor positioning"');
    expect(prompt).toContain("Me: why?");
    expect(
      prompt.trim().endsWith("My request, considering all items together: extract common patterns"),
    ).toBe(true);
  });

  it("compose clips each item to maxItemChars", () => {
    const prompt = compose({
      instruction: "x",
      maxItemChars: 10,
      items: [{ kind: "turn", content: "0123456789ABCDEF" }],
    });
    expect(prompt).toContain("012345678…");
    expect(prompt).not.toContain("ABCDEF");
  });
});

describe("bundlePrompt.downloadDoc", () => {
  it("wraps the output in a provenance header without re-formatting it", () => {
    const md = downloadDoc({
      output: "## Patterns\n- one\n- two",
      instruction: "summarize",
      date: "2026-07-22",
      sources: [
        { kind: "turn", title: "Physics chat", labels: ["physics"] },
        { kind: "thread", snippet: "anchor positioning" },
      ],
    });
    expect(md).toContain("# Synthesis");
    expect(md).toContain("- Generated: 2026-07-22");
    expect(md).toContain("- Prompt: summarize");
    expect(md).toContain("labeled answer");
    expect(md).toContain("[physics]");
    expect(md).toContain('thread — "anchor positioning"');
    expect(md.endsWith("## Patterns\n- one\n- two")).toBe(true);
  });
});
