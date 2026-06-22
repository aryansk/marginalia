// markdown.js — minimal, XSS-safe markdown → DOM renderer.
// It builds nodes with createElement + textContent only (never innerHTML),
// so untrusted model output cannot inject markup. Supports a practical subset:
// headings, fenced code, lists, blockquotes, hr, paragraphs, and inline
// (code, bold, italic, links).
var GA = GA || {};

GA.markdown = (function () {
  function render(md) {
    const frag = document.createDocumentFragment();
    const lines = String(md == null ? "" : md).replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^\s*```(.*)$/);
      if (fence) {
        const lang = fence[1].trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; // closing fence
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (lang) code.className = "language-" + lang.replace(/[^\w-]/g, "");
        code.textContent = buf.join("\n");
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }

      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const el = document.createElement("h" + h[1].length);
        inlineInto(h[2], el);
        frag.appendChild(el);
        i++;
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        frag.appendChild(document.createElement("hr"));
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i]))
          buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        const bq = document.createElement("blockquote");
        bq.appendChild(render(buf.join("\n")));
        frag.appendChild(bq);
        continue;
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const list = document.createElement(ordered ? "ol" : "ul");
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          const item = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, "");
          const li = document.createElement("li");
          inlineInto(item, li);
          list.appendChild(li);
        }
        frag.appendChild(list);
        continue;
      }

      // paragraph: gather until blank or next block
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i]))
        buf.push(lines[i++]);
      const p = document.createElement("p");
      inlineInto(buf.join("\n"), p);
      frag.appendChild(p);
    }
    return frag;
  }

  function isBlockStart(line) {
    return (
      /^\s*```/.test(line) ||
      /^(#{1,6})\s+/.test(line) ||
      /^\s*([-*+]|\d+\.)\s+/.test(line) ||
      /^\s*>\s?/.test(line) ||
      /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
    );
  }

  function inlineInto(text, parent) {
    const segs = String(text).split("\n");
    segs.forEach(function (seg, idx) {
      if (idx > 0) parent.appendChild(document.createElement("br"));
      parseInline(seg, parent);
    });
  }

  const INLINE =
    /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*]+?)\*|_([^_]+?)_|\[([^\]]+?)\]\(([^)\s]+)\)/;

  function parseInline(text, parent) {
    let rest = text;
    while (rest) {
      const m = rest.match(INLINE);
      if (!m) {
        parent.appendChild(document.createTextNode(rest));
        break;
      }
      if (m.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, m.index)));
      if (m[2] != null) {
        const c = document.createElement("code");
        c.textContent = m[2];
        parent.appendChild(c);
      } else if (m[3] != null || m[4] != null) {
        const b = document.createElement("strong");
        parseInline(m[3] != null ? m[3] : m[4], b);
        parent.appendChild(b);
      } else if (m[5] != null || m[6] != null) {
        const it = document.createElement("em");
        parseInline(m[5] != null ? m[5] : m[6], it);
        parent.appendChild(it);
      } else if (m[7] != null) {
        const a = document.createElement("a");
        a.textContent = m[7];
        const href = m[8];
        if (/^https?:\/\//i.test(href)) {
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        parent.appendChild(a);
      }
      rest = rest.slice(m.index + m[0].length);
    }
  }

  return { render };
})();
