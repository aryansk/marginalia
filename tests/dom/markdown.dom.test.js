// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

let GA;
beforeAll(() => {
  GA = loadGA([
    "src/core/tex-tables.js",
    "src/core/tex-unicode.js",
    "src/core/markdown-ast.js",
    "src/content/markdown.js",
  ]);
});

function render(md) {
  const host = document.createElement("div");
  host.appendChild(GA.markdown.render(md));
  return host;
}

describe("markdown render (AST -> DOM)", () => {
  it("renders bold, italic and inline code as the right elements", () => {
    const host = render("**b** *i* `c`");
    expect(host.querySelector("strong").textContent).toBe("b");
    expect(host.querySelector("em").textContent).toBe("i");
    expect(host.querySelector("code").textContent).toBe("c");
  });

  it("renders a code block as <pre><code> with literal text", () => {
    const host = render("```js\nconst x = 1;\n```");
    const code = host.querySelector("pre > code");
    expect(code.textContent).toBe("const x = 1;");
    expect(code.className).toBe("language-js");
  });

  it("renders lists", () => {
    const host = render("- a\n- b");
    expect(host.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("gives http(s) links target + rel; drops dangerous schemes", () => {
    const ok = render("[x](https://example.com)").querySelector("a");
    expect(ok.getAttribute("href")).toBe("https://example.com");
    expect(ok.getAttribute("rel")).toBe("noopener noreferrer");
    expect(ok.getAttribute("target")).toBe("_blank");

    const bad = render("[x](javascript:alert(1))").querySelector("a");
    expect(bad.getAttribute("href")).toBeNull(); // inert link
    expect(bad.textContent).toBe("x");
  });

  it("never injects markup from model text (XSS guard)", () => {
    const host = render('Hello <img src=x onerror="alert(1)"> world');
    expect(host.querySelector("img")).toBeNull(); // rendered as text, not an element
    expect(host.textContent).toContain("<img");
  });

  it("does not treat emphasis inside inline code as markup", () => {
    const host = render("`*x*`");
    expect(host.querySelector("code").textContent).toBe("*x*");
    expect(host.querySelector("em")).toBeNull();
  });
});

describe("math (AST -> DOM)", () => {
  it("renders inline math as a .ga-math span with real sub/sup elements", () => {
    const host = render("bound: $Pr_{h \\sim H} \\le \\frac{1}{m}$ holds");
    const span = host.querySelector("span.ga-math");
    expect(span).not.toBeNull();
    expect(span.classList.contains("ga-math-display")).toBe(false);
    expect(span.querySelector("sub").textContent).toBe("h ∼ H");
    expect(span.textContent).toBe("Prh ∼ H ≤ 1/m");
  });

  it("renders display math ($$…$$ on its own line) with the block class", () => {
    const host = render("intro\n\n$$x \\le \\frac{1}{m}$$");
    const span = host.querySelector("span.ga-math-display");
    expect(span).not.toBeNull();
    expect(span.textContent).toBe("x ≤ 1/m");
  });

  it("keeps model text inside math inert (XSS guard)", () => {
    const host = render('$<img src=x onerror="alert(1)">$');
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img");
  });

  it("does not italicize formula subscripts (the mangling bug)", () => {
    const host = render("choose $n_1 * m_2$ keys");
    expect(host.querySelector("em")).toBeNull();
    expect(host.querySelectorAll(".ga-math sub")).toHaveLength(2);
  });
});

describe("makeStreamRenderer (incremental streaming render)", () => {
  // Simulate a stream: at every prefix flush, the incrementally-updated DOM
  // must equal a one-shot render of the same text.
  it("matches the one-shot render at every step of a streamed transcript", () => {
    const full = [
      "# Answer",
      "",
      "An 8 KB page is the *default* granularity.",
      "",
      "- point one",
      "- point two grows here",
      "",
      "```js",
      "const pageSize = 8 * 1024;",
      "```",
      "",
      "$$Pr_{h \\sim H} \\le \\frac{1}{m}$$",
      "",
      "> quoted conclusion",
    ].join("\n");

    const el = document.createElement("div");
    const r = GA.markdown.makeStreamRenderer(el);
    for (let cut = 1; cut <= full.length; cut += 7) {
      const text = full.slice(0, cut);
      r.update(text);
      expect(el.innerHTML).toBe(render(text).innerHTML);
    }
    r.update(full);
    expect(el.innerHTML).toBe(render(full).innerHTML);
  });

  it("handles a full rewrite (reset frame) cleanly", () => {
    const el = document.createElement("div");
    const r = GA.markdown.makeStreamRenderer(el);
    r.update("first answer\n\nwith two blocks");
    r.update("totally different");
    expect(el.innerHTML).toBe(render("totally different").innerHTML);
  });
});

describe("tables and nested lists (AST -> DOM)", () => {
  it("renders a table with thead/tbody", () => {
    const host = render("| a | b |\n|---|---|\n| 1 | 2 |");
    const table = host.querySelector("table.ga-table");
    expect(table).not.toBeNull();
    expect(table.querySelectorAll("thead th")).toHaveLength(2);
    expect(table.querySelectorAll("tbody td")).toHaveLength(2);
    expect(table.querySelector("tbody td").textContent).toBe("1");
  });

  it("renders nested lists as nested ul/ol inside li", () => {
    const host = render("- a\n  - a1\n- b");
    const topItems = host.querySelectorAll(":scope > ul > li");
    expect(topItems).toHaveLength(2);
    expect(topItems[0].querySelector("ul li").textContent).toBe("a1");
  });
});
