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
    expect(inlineOf("[ok](https://x.com)")[0]).toMatchObject({ type: "link", href: "https://x.com" });
    expect(inlineOf("[x](javascript:alert(1))")[0]).toMatchObject({ type: "link", href: null });
  });

  it("emits a <br> node between hard-wrapped lines of a paragraph", () => {
    expect(inlineOf("one\ntwo").some((n) => n.type === "br")).toBe(true);
  });
});
