// The streaming parser's safety proof: for every growing prefix of every
// fixture, the incremental parse (parseStream, carrying state from the
// previous prefix) must produce an AST deep-equal to a fresh full parse.
// This test intentionally lands BEFORE the renderer consumes parseStream.
import { describe, it, expect } from "vitest";
import ast from "../../src/core/markdown-ast.js";

const FIXTURES = {
  prose: "Just a paragraph.\n\nAnd another one\nwith a soft break.",
  headings: "# Title\n\nintro text\n\n## Section\n\nbody **bold** and *em* and `code`.",
  fences:
    "before\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\nafter\n\n```\nunclosed fence tail\nmore code",
  lateTable:
    "Results so far\n\n| name | score |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n\ntrailing note",
  lists:
    "Steps:\n\n- one\n- two\n  - nested a\n  - nested b\n- three\n\n1. first\n2. second\n\nend.",
  blockquote: "> quoted line one\n> quoted line two\n\nplain after quote",
  math: "Inline $a+b$ and display:\n\n$$\n\\frac{a}{b} + c\n$$\n\nChatGPT style \\(x^2\\) and\n\n\\[\ne^{i\\pi} = -1\n\\]\n\ndone",
  mixed:
    "# Report\n\nIntro paragraph with [link](https://x.example) and $E=mc^2$.\n\n- item one\n- item two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> a quote\n\n```py\nprint(1)\n```\n\n---\n\nclosing words\nwith a break.",
  hrAndEdge: "para\n\n---\n\n***\n\n# after rules\n\n$5 and $10 stay plain\n\n_tail em_",
};

const deep = (x) => JSON.parse(JSON.stringify(x));

describe("parseStream — incremental === full, at every prefix", () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`fixture: ${name}`, () => {
      let state = null;
      for (let end = 1; end <= doc.length; end++) {
        const text = doc.slice(0, end);
        const res = ast.parseStream(state, text);
        state = res.state;
        expect(deep(res.blocks)).toEqual(deep(ast.parse(text)));
      }
    });
  }

  it("a mid-stream rewrite (prefix mismatch) falls back to a correct full parse", () => {
    const doc = FIXTURES.mixed;
    let state = null;
    for (let end = 1; end <= doc.length; end += 7) {
      state = ast.parseStream(state, doc.slice(0, end)).state;
    }
    const rewritten = "REWRITTEN. " + doc.slice(11);
    const res = ast.parseStream(state, rewritten);
    expect(deep(res.blocks)).toEqual(deep(ast.parse(rewritten)));
  });

  it("actually reuses stable prefix blocks by identity (not a vacuous full parse)", () => {
    const base = "# One\n\npara one.\n\n# Two\n\npara two.\n\n# Three\n\ntail";
    let state = null;
    const r1 = ast.parseStream(state, base);
    const r2 = ast.parseStream(r1.state, base + " grows here");
    expect(r2.blocks.length).toBeGreaterThanOrEqual(4);
    // Blocks before the last two are the SAME objects — the fast path
    // firstChangedBlock relies on (and the O(answer) claim rests on).
    expect(r2.blocks[0]).toBe(r1.blocks[0]);
    expect(r2.blocks[1]).toBe(r1.blocks[1]);
  });

  it("randomized fuzz: chunked growth over a generated document", () => {
    // Deterministic PRNG (no Math.random in tests — reproducibility).
    let seed = 0xc0ffee;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const atoms = [
      "plain words here. ",
      "**bold** ",
      "`code` ",
      "$x_i$ ",
      "\n\n",
      "\n",
      "# H\n",
      "- item\n",
      "1. item\n",
      "> quote\n",
      "| a | b |\n| - | - |\n| 1 | 2 |\n",
      "```\nfence line\n```\n",
      "$$\nx+y\n$$\n",
      "---\n",
      "\\(inline\\) ",
    ];
    for (let round = 0; round < 8; round++) {
      let doc = "";
      for (let i = 0; i < 40; i++) doc += atoms[Math.floor(rnd() * atoms.length)];
      let state = null;
      let at = 0;
      while (at < doc.length) {
        at = Math.min(doc.length, at + 1 + Math.floor(rnd() * 9));
        const text = doc.slice(0, at);
        const res = ast.parseStream(state, text);
        state = res.state;
        expect(deep(res.blocks)).toEqual(deep(ast.parse(text)));
      }
    }
  });
});
