import { describe, it, expect } from "vitest";
import prompt from "../../src/core/prompt.js";

const { composePrompt } = prompt;

function thread(over = {}) {
  return Object.assign(
    {
      selector: { exact: "8 KB page" },
      section: "A B+ tree node fits in one 8 KB page because that is the OS page size.",
      messages: [{ role: "user", text: "why 8 KB and not 4 KB?" }],
    },
    over
  );
}

describe("composePrompt — context-scope Strategy", () => {
  it("'selection' includes only the highlighted text as context", () => {
    const out = composePrompt(thread(), "selection", {});
    expect(out).toContain('"""\n8 KB page\n"""');
    expect(out).not.toContain("OS page size");
  });

  it("'section' includes the answer section", () => {
    const out = composePrompt(thread(), "section", {});
    expect(out).toContain("OS page size");
  });

  it("'section' falls back to the exact text when section is empty", () => {
    const out = composePrompt(thread({ section: "" }), "section", {});
    expect(out).toContain('"""\n8 KB page\n"""');
  });

  it("'conversation' uses the injected conversation text", () => {
    const out = composePrompt(thread(), "conversation", { conversationText: "FULL CHAT TEXT" });
    expect(out).toContain("FULL CHAT TEXT");
  });

  it("unknown scope falls back to 'section'", () => {
    const out = composePrompt(thread(), "bogus", {});
    expect(out).toContain("OS page size");
  });
});

describe("composePrompt — structure", () => {
  it("includes the highlighted phrase and the Q/A turns in order", () => {
    const out = composePrompt(
      thread({
        messages: [
          { role: "user", text: "why 8 KB?" },
          { role: "model", text: "Because the OS page is 8 KB." },
          { role: "user", text: "and 16 KB?" },
        ],
      }),
      "selection",
      {}
    );
    expect(out).toContain('I highlighted this specific part: "8 KB page"');
    expect(out.indexOf("Me: why 8 KB?")).toBeLessThan(out.indexOf("You: Because the OS page is 8 KB."));
    expect(out.indexOf("You: Because the OS page is 8 KB.")).toBeLessThan(out.indexOf("Me: and 16 KB?"));
  });

  it("is well-formed with no messages yet", () => {
    const out = composePrompt(thread({ messages: [] }), "selection", {});
    expect(out).toContain("Our follow-up discussion so far:");
  });

  it("preserves special characters in the text", () => {
    const out = composePrompt(thread({ selector: { exact: 'the "B+" index ☞' } }), "selection", {});
    expect(out).toContain('the "B+" index ☞');
  });
});
