// markdown-ast.js — pure: parse a markdown subset into a small AST. No DOM, so
// the grammar is unit-testable; content/markdown.js renders the AST to DOM.
//
// Block nodes:  {type:'heading',level,inline} | {type:'code',lang,text} |
//               {type:'hr'} | {type:'blockquote',children:[block]} |
//               {type:'list',ordered,items:[[inline]]} | {type:'paragraph',inline}
// Inline nodes: {type:'text',value} | {type:'code',value} | {type:'br'} |
//               {type:'strong',children:[inline]} | {type:'em',children:[inline]} |
//               {type:'link',text,href|null}   (href null => render as plain text)
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.markdownAst = (function () {
  const FENCE = /^\s*```(.*)$/;
  const HEADING = /^(#{1,6})\s+(.*)$/;
  const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s*>\s?/;
  const LIST = /^\s*([-*+]|\d+\.)\s+/;
  const ORDERED = /^\s*\d+\.\s+/;
  // Bold uses [\s\S]+? (not [^*]) so it can contain nested *emphasis*; italic
  // stays single-char. Backtick code is first so emphasis inside code is inert.
  const INLINE =
    /(`+)([^`]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*]+?)\*|_([^_]+?)_|\[([^\]]+?)\]\(([^)\s]+)\)/;

  function parse(md) {
    const text = String(md == null ? "" : md).replace(/\r\n/g, "\n");
    return parseBlocks(text.split("\n"));
  }

  function isBlockStart(line) {
    return FENCE.test(line) || HEADING.test(line) || LIST.test(line) || QUOTE.test(line) || HR.test(line);
  }

  function parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(FENCE);
      if (fence) {
        const lang = fence[1].trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; // consume closing fence (no-op if we ran off the end — unclosed fence)
        blocks.push({ type: "code", lang, text: buf.join("\n") });
        continue;
      }
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }
      const h = line.match(HEADING);
      if (h) {
        blocks.push({ type: "heading", level: h[1].length, inline: parseInlineLines(h[2]) });
        i++;
        continue;
      }
      if (HR.test(line)) {
        blocks.push({ type: "hr" });
        i++;
        continue;
      }
      if (QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(QUOTE, ""));
        blocks.push({ type: "blockquote", children: parseBlocks(buf) });
        continue;
      }
      if (LIST.test(line)) {
        const ordered = ORDERED.test(line);
        const items = [];
        while (i < lines.length && LIST.test(lines[i])) {
          items.push(parseInlineLines(lines[i++].replace(LIST, "")));
        }
        blocks.push({ type: "list", ordered, items });
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) buf.push(lines[i++]);
      blocks.push({ type: "paragraph", inline: parseInlineLines(buf.join("\n")) });
    }
    return blocks;
  }

  // Split on hard newlines into <br>-separated runs of inline nodes.
  function parseInlineLines(text) {
    const out = [];
    String(text)
      .split("\n")
      .forEach((seg, idx) => {
        if (idx > 0) out.push({ type: "br" });
        pushInline(seg, out);
      });
    return out;
  }

  function inlineChildren(text) {
    const out = [];
    pushInline(text, out);
    return out;
  }

  function pushInline(text, out) {
    let rest = text;
    while (rest) {
      const m = rest.match(INLINE);
      if (!m) {
        out.push({ type: "text", value: rest });
        break;
      }
      if (m.index > 0) out.push({ type: "text", value: rest.slice(0, m.index) });
      if (m[2] != null) out.push({ type: "code", value: m[2] });
      else if (m[3] != null || m[4] != null)
        out.push({ type: "strong", children: inlineChildren(m[3] != null ? m[3] : m[4]) });
      else if (m[5] != null || m[6] != null)
        out.push({ type: "em", children: inlineChildren(m[5] != null ? m[5] : m[6]) });
      else if (m[7] != null) out.push({ type: "link", text: m[7], href: safeHref(m[8]) });
      rest = rest.slice(m.index + m[0].length);
    }
  }

  // Only http(s) links get a real href; everything else (javascript:, data:, …)
  // renders as inert text. This is the markdown half of the XSS guard.
  function safeHref(href) {
    return /^https?:\/\//i.test(href) ? href : null;
  }

  return { parse };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.markdownAst;
