// markdown.js — render the markdown AST (core/markdown-ast.js) to DOM.
// XSS-safe: nodes are built with createElement + textContent only (never
// innerHTML), and only http(s) links (resolved in markdown-ast) get an href.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.markdown = (function () {
  function render(md) {
    return renderAst(GA.core.markdownAst.parse(md));
  }

  // Incremental renderer for a streaming message: each update re-parses the
  // accumulated text (cheap) but rebuilds DOM only from the first changed block
  // — O(1) DOM work per frame on an append-only stream instead of a full
  // subtree rebuild. `el` must be owned exclusively by this renderer (one node
  // per block, matching renderAst's output shape).
  function makeStreamRenderer(el) {
    let blocks = [];
    return {
      update(text) {
        const ast = GA.core.markdownAst.parse(text);
        const from = GA.core.markdownAst.firstChangedBlock(blocks, ast);
        while (el.childNodes.length > from) el.removeChild(el.lastChild);
        for (let i = from; i < ast.length; i++) el.appendChild(renderBlock(ast[i]));
        blocks = ast;
      },
    };
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
        // Chrome around the block: language label + copy button. GA.icons /
        // GA.copyText live in other content modules; render a bare <pre> when
        // they're absent (pure-markdown test contexts).
        if (!GA.icons || !GA.copyText) return pre;
        const label = document.createElement("span");
        label.className = "ga-codeblock-lang";
        label.textContent = b.lang || "";
        const copyBtn = GA.el(
          "button",
          {
            class: "ga-iconbtn ga-codeblock-copy",
            title: "Copy code",
            "aria-label": "Copy code",
            onclick: function (e) {
              e.stopPropagation();
              GA.copyText(b.text);
              GA.icons.swap(copyBtn, "check");
              // Guarded fallback: pure-markdown test contexts load without config.js.
              setTimeout(
                () => copyBtn.isConnected && GA.icons.swap(copyBtn, "copy"),
                (GA.config && GA.config.COPY_FEEDBACK_MS) || 1500,
              );
            },
          },
          GA.icons.make("copy"),
        );
        const head = GA.el("div", { class: "ga-codeblock-head" }, [label, copyBtn]);
        return GA.el("div", { class: "ga-codeblock" }, [head, pre]);
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
          renderInline(item.inline || [], li);
          if (item.children) li.appendChild(renderBlock(item.children));
          list.appendChild(li);
        });
        return list;
      }
      case "table": {
        const table = document.createElement("table");
        table.className = "ga-table";
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        (b.header || []).forEach((cell) => {
          const th = document.createElement("th");
          renderInline(cell, th);
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        (b.rows || []).forEach((row) => {
          const tr = document.createElement("tr");
          row.forEach((cell) => {
            const td = document.createElement("td");
            renderInline(cell, td);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
      }
      case "math":
        return mathEl(b);
      default: {
        const p = document.createElement("p");
        renderInline(b.inline, p);
        return p;
      }
    }
  }

  // A math node (core/tex-unicode.js output): a span (valid inside <p>; CSS
  // makes the display variant a centered block). Children are text/<sub>/<sup>
  // only — still createElement + textContent, never innerHTML.
  function mathEl(n) {
    const span = document.createElement("span");
    span.className = "ga-math" + (n.display ? " ga-math-display" : "");
    renderInline(n.inline, span);
    return span;
  }

  function renderInline(nodes, parent) {
    nodes.forEach((n) => {
      if (n.type === "text") {
        parent.appendChild(document.createTextNode(n.value));
      } else if (n.type === "br") {
        parent.appendChild(document.createElement("br"));
      } else if (n.type === "math") {
        parent.appendChild(mathEl(n));
      } else if (n.type === "sub" || n.type === "sup") {
        const el = document.createElement(n.type);
        renderInline(n.children, el);
        parent.appendChild(el);
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

  return { render, renderAst, makeStreamRenderer };
})();
