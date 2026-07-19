import { describe, it, expect } from "vitest";
import md from "../../src/core/markdown-ast.js";

const { parse } = md;
const types = (blocks) => blocks.map((b) => b.type);

describe("markdown-ast — blocks", () => {
  it("returns [] for empty / null / whitespace", () => {
    expect(parse("")).toEqual([]);
    expect(parse(null)).toEqual([]);
    expect(parse("   \n\n  ")).toEqual([]);
  });

  it("parses headings h1..h6; 7 hashes degrade to a paragraph", () => {
    expect(parse("# Title")[0]).toMatchObject({ type: "heading", level: 1 });
    expect(parse("###### Six")[0]).toMatchObject({ type: "heading", level: 6 });
    expect(parse("####### Seven")[0].type).toBe("paragraph");
  });

  it("parses a fenced code block with a language", () => {
    const node = parse("```js\nconst x = 1;\n```")[0];
    expect(node).toMatchObject({ type: "code", lang: "js", text: "const x = 1;" });
  });

  it("treats an unclosed fence as code to the end of input", () => {
    const node = parse("```\nline one\nline two")[0];
    expect(node).toMatchObject({ type: "code", text: "line one\nline two" });
  });

  it("does not parse markdown inside a code block", () => {
    const node = parse("```\n**not bold**\n```")[0];
    expect(node.text).toBe("**not bold**");
  });

  it("parses ordered and unordered lists", () => {
    expect(parse("- a\n- b")[0]).toMatchObject({ type: "list", ordered: false });
    expect(parse("1. a\n2. b")[0]).toMatchObject({ type: "list", ordered: true });
    expect(parse("- a\n- b")[0].items).toHaveLength(2);
  });

  it("parses blockquotes, including nested blocks", () => {
    const bq = parse("> ## quoted heading\n> text")[0];
    expect(bq.type).toBe("blockquote");
    expect(types(bq.children)).toContain("heading");
  });

  it("parses horizontal rules (---, ***, ___)", () => {
    expect(parse("---")[0].type).toBe("hr");
    expect(parse("***")[0].type).toBe("hr");
    expect(parse("___")[0].type).toBe("hr");
  });

  it("joins consecutive non-blank lines into one paragraph", () => {
    const blocks = parse("line one\nline two\n\nsecond para");
    expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
  });

  it("normalizes CRLF", () => {
    expect(parse("# Hi\r\nbody")).toHaveLength(2);
  });
});

describe("markdown-ast — inline", () => {
  const inlineOf = (s) => parse(s)[0].inline;

  it("parses bold, italic and inline code", () => {
    expect(inlineOf("**b**")[0]).toMatchObject({ type: "strong" });
    expect(inlineOf("*i*")[0]).toMatchObject({ type: "em" });
    expect(inlineOf("`c`")[0]).toMatchObject({ type: "code", value: "c" });
  });

  it("nests emphasis inside bold", () => {
    const strong = inlineOf("**a *b* c**")[0];
    expect(strong.type).toBe("strong");
    expect(strong.children.some((n) => n.type === "em")).toBe(true);
  });

  it("does not parse emphasis inside inline code", () => {
    const code = inlineOf("`*x*`")[0];
    expect(code).toMatchObject({ type: "code", value: "*x*" });
  });

  it("keeps http(s) links but drops dangerous schemes (href = null)", () => {
    expect(inlineOf("[ok](https://x.com)")[0]).toMatchObject({
      type: "link",
      href: "https://x.com",
    });
    expect(inlineOf("[x](javascript:alert(1))")[0]).toMatchObject({ type: "link", href: null });
  });

  it("emits a <br> node between hard-wrapped lines of a paragraph", () => {
    expect(inlineOf("one\ntwo").some((n) => n.type === "br")).toBe(true);
  });
});

describe("firstChangedBlock (streaming block diff)", () => {
  const { firstChangedBlock } = md;
  const diff = (a, b) => firstChangedBlock(parse(a), parse(b));

  it("appending to the last paragraph changes only that block", () => {
    expect(diff("Intro.\n\nSecond par", "Intro.\n\nSecond paragraph grows")).toBe(1);
  });

  it("a brand-new block leaves earlier blocks untouched", () => {
    expect(diff("Intro.", "Intro.\n\n- item")).toBe(1);
    expect(diff("Intro.\n\n- item", "Intro.\n\n- item\n\nOutro")).toBe(2);
  });

  it("a growing open fence keeps re-rendering only the code block", () => {
    expect(diff("Text\n\n```js\nconst a", "Text\n\n```js\nconst a = 1;\nconst b")).toBe(1);
  });

  it("a growing list re-renders only the list block", () => {
    expect(diff("Head\n\n- a", "Head\n\n- a\n- b")).toBe(1);
  });

  it("identical parses change nothing (index == length)", () => {
    expect(diff("a\n\nb", "a\n\nb")).toBe(2);
  });

  it("a full rewrite restarts from block 0", () => {
    expect(diff("Hello world", "Goodbye world")).toBe(0);
  });

  it("a shrink (fewer blocks) returns the shorter length", () => {
    expect(diff("a\n\nb\n\nc", "a\n\nb")).toBe(2);
  });
});

describe("markdown-ast — nested lists", () => {
  it("indented items become the previous item's child list", () => {
    const list = parse("- a\n  - a1\n  - a2\n- b")[0];
    expect(list.type).toBe("list");
    expect(list.items).toHaveLength(2);
    const [a, b] = list.items;
    expect(a.children).toMatchObject({ type: "list" });
    expect(a.children.items).toHaveLength(2);
    expect(b.children).toBeNull();
  });

  it("supports a nested ordered list inside an unordered one", () => {
    const list = parse("- a\n  1. one\n  2. two")[0];
    expect(list.ordered).toBe(false);
    expect(list.items[0].children.ordered).toBe(true);
  });

  it("deeper nesting unwinds correctly", () => {
    const list = parse("- a\n  - a1\n    - a1i\n- b")[0];
    expect(list.items).toHaveLength(2);
    expect(list.items[0].children.items[0].children.items).toHaveLength(1);
  });
});

describe("markdown-ast — math", () => {
  const inlineOf = (s) => parse(s)[0].inline;
  const flat = (nodes) =>
    nodes
      .map((n) => {
        if (n.type === "text") return n.value;
        if (n.type === "sub") return "_(" + flat(n.children) + ")";
        if (n.type === "sup") return "^(" + flat(n.children) + ")";
        return "<" + n.type + ">";
      })
      .join("");

  it("parses all four delimiter forms into math nodes", () => {
    expect(inlineOf("cost is $O(N)$ here")[1]).toMatchObject({
      type: "math",
      display: false,
      tex: "O(N)",
    });
    expect(inlineOf("bound \\(p > |U|\\) holds")[1]).toMatchObject({
      type: "math",
      display: false,
    });
    expect(inlineOf("so $$x \\le y$$ holds")[1]).toMatchObject({ type: "math", display: true });
    expect(inlineOf("so \\[x \\le y\\] holds")[1]).toMatchObject({ type: "math", display: true });
  });

  it("prettifies the tex into renderable inline nodes", () => {
    const m = inlineOf("$Pr_{h \\sim H} \\le \\frac{1}{m}$")[0];
    expect(flat(m.inline)).toBe("Pr_(h ∼ H) ≤ 1/m");
  });

  it("protects _ and * inside math from the emphasis rules", () => {
    const nodes = inlineOf("$n_1 * m_2$ and $a_b$");
    expect(nodes[0].type).toBe("math");
    expect(nodes[2].type).toBe("math");
    expect(nodes.some((n) => n.type === "em" || n.type === "strong")).toBe(false);
  });

  it("does not mistake currency for math ($5 and $10)", () => {
    const nodes = inlineOf("it costs $5 and $10 today");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: "text", value: "it costs $5 and $10 today" });
  });

  it("parses a display-math block on its own line", () => {
    const blocks = parse("intro\n\n$$Pr_{h \\sim H} \\le \\frac{1}{m}$$\n\noutro");
    expect(types(blocks)).toEqual(["paragraph", "math", "paragraph"]);
    expect(blocks[1].display).toBe(true);
  });

  it("parses a multi-line $$ block and \\[ \\] block", () => {
    const b = parse("$$\nx \\le y\n$$")[0];
    expect(b).toMatchObject({ type: "math", display: true, tex: "x \\le y" });
    const c = parse("\\[\nx + y\n\\]")[0];
    expect(c).toMatchObject({ type: "math", display: true, tex: "x + y" });
  });

  it("an unclosed $$ block runs to the end of input (streaming)", () => {
    const b = parse("$$\nx \\le")[0];
    expect(b).toMatchObject({ type: "math", tex: "x \\le" });
  });

  it("a math fence ends the preceding paragraph", () => {
    const blocks = parse("text line\n$$x$$");
    expect(types(blocks)).toEqual(["paragraph", "math"]);
  });

  it("streaming: a growing math block re-renders only itself", () => {
    const { firstChangedBlock } = md;
    const diff = (a, b) => firstChangedBlock(parse(a), parse(b));
    expect(diff("Head\n\n$$x \\le", "Head\n\n$$x \\le y$$")).toBe(1);
  });
});

describe("markdown-ast — tables", () => {
  it("parses a pipe table with header + rows", () => {
    const t = parse("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |")[0];
    expect(t.type).toBe("table");
    expect(t.header).toHaveLength(2);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0][0]).toMatchObject({ type: "text", value: "1" });
  });

  it("outer pipes are optional and cells parse inline markup", () => {
    const t = parse("a | **b**\n--- | ---\nx | y")[0];
    expect(t.type).toBe("table");
    expect(t.header[1][0]).toMatchObject({ type: "strong" });
  });

  it("a separator row alone is not a table (and --- is still an hr)", () => {
    expect(parse("---")[0]).toMatchObject({ type: "hr" });
    expect(parse("just | pipes")[0].type).toBe("paragraph");
  });

  it("the table ends at a blank line", () => {
    const blocks = parse("| a |\n|---|\n| 1 |\n\nafter");
    expect(blocks[0].type).toBe("table");
    expect(blocks[1].type).toBe("paragraph");
  });
});
