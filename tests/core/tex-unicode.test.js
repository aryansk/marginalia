import { describe, it, expect } from "vitest";
import tex from "../../src/core/tex-unicode.js";

const { toInline } = tex;

// Flatten nodes to a readable string: sub -> _(…), sup -> ^(…).
function flat(nodes) {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.value;
      if (n.type === "sub") return "_(" + flat(n.children) + ")";
      if (n.type === "sup") return "^(" + flat(n.children) + ")";
      return "?";
    })
    .join("");
}

const conv = (s) => flat(toInline(s));

describe("tex-unicode — symbols and alphabets", () => {
  it("maps table symbols to unicode", () => {
    expect(conv("x \\le y")).toBe("x ≤ y");
    expect(conv("h \\sim H")).toBe("h ∼ H");
    expect(conv("\\alpha + \\Theta")).toBe("α + Θ");
    expect(conv("a \\in \\varnothing")).toBe("a ∈ ∅");
  });

  it("maps \\mathcal / \\mathbb / \\mathfrak through the alphabet tables", () => {
    expect(conv("\\mathcal{H}")).toBe("𝓗");
    expect(conv("\\mathbb{R}")).toBe("ℝ");
    expect(conv("\\mathfrak{g}")).toBe("𝔤");
    // digits have blackboard forms too; chars without a table entry pass through
    expect(conv("\\mathbb{R2}")).toBe("ℝ𝟚");
    expect(conv("\\mathcal{H+}")).toBe("𝓗+");
  });

  it("unwraps text-mode wrappers", () => {
    expect(conv("\\text{Pr}")).toBe("Pr");
    expect(conv("\\mathrm{mod}")).toBe("mod");
    expect(conv("\\operatorname{argmax}")).toBe("argmax");
  });

  it("keeps unknown commands as literal text — nothing is dropped", () => {
    expect(conv("\\notacommand x")).toBe("\\notacommand x");
    expect(conv("\\begin{align}")).toBe("\\beginalign"); // group unwraps, command stays visible
  });
});

describe("tex-unicode — structure", () => {
  it("builds sub/sup nodes from _{} and ^{} (and single-char forms)", () => {
    expect(conv("x_{i}")).toBe("x_(i)");
    expect(conv("x_i")).toBe("x_(i)");
    expect(conv("x^2")).toBe("x^(2)");
    expect(conv("x_{i+1}^{2n}")).toBe("x_(i+1)^(2n)");
    expect(conv("x_\\alpha")).toBe("x_(α)");
  });

  it("renders \\frac linearly, parenthesizing ambiguous operands", () => {
    expect(conv("\\frac{1}{m}")).toBe("1/m");
    expect(conv("\\frac{1}{22}")).toBe("1/22");
    expect(conv("\\frac{1}{2m}")).toBe("1/(2m)");
    expect(conv("\\frac{a+b}{c}")).toBe("(a+b)/c");
  });

  it("renders \\sqrt with the radical sign", () => {
    expect(conv("\\sqrt{x}")).toBe("√x");
    expect(conv("\\sqrt{a+b}")).toBe("√(a+b)");
  });

  it("strips sizing/fencing commands to their delimiter", () => {
    expect(conv("\\big((ax+b) \\bmod p\\big)")).toBe("((ax+b) mod p)");
    expect(conv("\\left( x \\right)")).toBe("( x )");
    expect(conv("\\left. x \\right|")).toBe(" x |");
  });

  it("handles mod commands", () => {
    expect(conv("a \\bmod m")).toBe("a mod m");
    expect(conv("a \\pmod{m}")).toBe("a (mod m)");
  });

  it("unwraps bare groups, keeps unbalanced braces visible", () => {
    expect(conv("{ab}c")).toBe("abc");
    expect(conv("a}b")).toBe("a}b");
    expect(conv("{ab")).toBe("ab"); // unclosed group runs to the end
  });

  it("collapses whitespace (multi-line display math becomes one line)", () => {
    expect(conv("a =\n  b")).toBe("a = b");
    expect(conv("a \\, b \\; c \\! d")).toBe("a b c d");
  });

  it("escaped control symbols stay literal", () => {
    expect(conv("\\{x\\}")).toBe("{x}");
    expect(conv("100\\%")).toBe("100%");
  });

  it("guards pathological brace nesting instead of recursing forever", () => {
    const deep = "{".repeat(500) + "x" + "}".repeat(500);
    expect(conv(deep)).toContain("x"); // must terminate and keep the content
  });
});

describe("tex-unicode — real formulas from the field", () => {
  it("universal-hashing collision bound (Gemini, $$…$$ content)", () => {
    expect(conv("Pr_{h \\sim H} [h(x) = h(y)] \\le \\frac{1}{m}")).toBe(
      "Pr_(h ∼ H) [h(x) = h(y)] ≤ 1/m"
    );
  });

  it("the same bound with \\text and \\mathcal", () => {
    expect(conv("\\text{Pr}_{h \\sim \\mathcal{H}} [h(x) = h[y]] \\le \\frac{1}{m}")).toBe(
      "Pr_(h ∼ 𝓗) [h(x) = h[y]] ≤ 1/m"
    );
  });

  it("hash-family definition (ChatGPT, \\[…\\] content)", () => {
    expect(conv("h_{a,b}(x) =\\big((ax+b)\\bmod p\\big)\\bmod m")).toBe(
      "h_(a,b)(x) =((ax+b) mod p) mod m"
    );
  });

  it("big-O stays untouched", () => {
    expect(conv("O(N)")).toBe("O(N)");
    expect(conv("O(N \\log N)")).toBe("O(N log N)");
  });
});
