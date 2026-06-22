// markdown.js — render the markdown AST (core/markdown-ast.js) to DOM.
// XSS-safe: nodes are built with createElement + textContent only (never
// innerHTML), and only http(s) links (resolved in markdown-ast) get an href.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.markdown = (function () {
  function render(md) {
    return renderAst(GA.core.markdownAst.parse(md));
  }

  function renderAst(blocks) {
    const frag = document.createDocumentFragment();
    blocks.forEach((b) => frag.appendChild(renderBlock(b)));
    return frag;
  }

  function renderBlock(b) {
    switch (b.type) {
      case "code": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (b.lang) code.className = "language-" + b.lang.replace(/[^\w-]/g, "");
        code.textContent = b.text;
        pre.appendChild(code);
        return pre;
      }
      case "heading": {
        const h = document.createElement("h" + b.level);
        renderInline(b.inline, h);
        return h;
      }
      case "hr":
        return document.createElement("hr");
      case "blockquote": {
        const bq = document.createElement("blockquote");
        b.children.forEach((c) => bq.appendChild(renderBlock(c)));
        return bq;
      }
      case "list": {
        const list = document.createElement(b.ordered ? "ol" : "ul");
        b.items.forEach((item) => {
          const li = document.createElement("li");
          renderInline(item, li);
          list.appendChild(li);
        });
        return list;
      }
      default: {
        const p = document.createElement("p");
        renderInline(b.inline, p);
        return p;
      }
    }
  }

  function renderInline(nodes, parent) {
    nodes.forEach((n) => {
      if (n.type === "text") {
        parent.appendChild(document.createTextNode(n.value));
      } else if (n.type === "br") {
        parent.appendChild(document.createElement("br"));
      } else if (n.type === "code") {
        const c = document.createElement("code");
        c.textContent = n.value;
        parent.appendChild(c);
      } else if (n.type === "strong") {
        const s = document.createElement("strong");
        renderInline(n.children, s);
        parent.appendChild(s);
      } else if (n.type === "em") {
        const e = document.createElement("em");
        renderInline(n.children, e);
        parent.appendChild(e);
      } else if (n.type === "link") {
        const a = document.createElement("a");
        a.textContent = n.text;
        if (n.href) {
          a.href = n.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        parent.appendChild(a);
      }
    });
  }

  return { render, renderAst };
})();
