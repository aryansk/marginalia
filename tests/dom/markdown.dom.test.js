// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

let GA;
beforeAll(() => {
  GA = loadGA(["src/core/markdown-ast.js", "src/content/markdown.js"]);
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
