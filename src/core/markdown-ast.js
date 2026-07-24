// markdown-ast.js — pure: parse a markdown subset into a small AST. No DOM, so
// the grammar is unit-testable; content/markdown.js renders the AST to DOM.
//
// Block nodes:  {type:'heading',level,inline} | {type:'code',lang,text} |
//               {type:'hr'} | {type:'blockquote',children:[block]} |
//               {type:'list',ordered,items:[{inline,children:list|null}]} |
//               {type:'table',header:[[inline]],rows:[[[inline]]]} |
//               {type:'paragraph',inline}
// Inline nodes: {type:'text',value} | {type:'code',value} | {type:'br'} |
//               {type:'strong',children:[inline]} | {type:'em',children:[inline]} |
//               {type:'link',text,href|null}   (href null => render as plain text)
// Math (block and inline): {type:'math',display,tex,inline:[inline]} — the four
// delimiter forms LLMs emit ($$…$$ and $…$ from Gemini/Claude, \[…\] and \(…\)
// from ChatGPT) become inert nodes whose `inline` is prettified by
// core/tex-unicode.js, so _ and * inside formulas never hit the emphasis rules.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};
// Browser: core/tex-unicode.js loaded earlier set GA.core.texUnicode.
// Node/tests: require it so this module stays importable on its own.
var texUnicode =
  GA.core.texUnicode || (typeof require !== "undefined" ? require("./tex-unicode.js") : null);

GA.core.markdownAst = (function () {
  const FENCE = /^\s*```(.*)$/;
  const HEADING = /^(#{1,6})\s+(.*)$/;
  const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s*>\s?/;
  const LIST = /^(\s*)([-*+]|\d+\.)\s+/;
  const ORDERED = /^\s*\d+\.\s+/;
  // GFM pipe-table separator row: |---|:--:|--- (at least one dash per cell)
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  // Display-math fence opener: a line starting with $$ or \[ (closed by the
  // matching $$ / \], possibly lines later — handled like FENCE).
  const MATH_FENCE = /^\s*(\$\$|\\\[)\s*([\s\S]*)$/;
  // Bold uses [\s\S]+? (not [^*]) so it can contain nested *emphasis*; italic
  // stays single-char. Backtick code is first so emphasis inside code is inert;
  // math is next so _ and * inside formulas are inert too. Single-$ math uses
  // the Pandoc currency guard: content can't start/end with whitespace and the
  // closing $ can't be followed by a digit, so "$5 and $10" stays plain text.
  //
  // Named group → AST node (dispatched in pushInline):
  //   tick / code           `…`        {type:'code'}    (tick backrefs the fence)
  //   mathDollars           $$…$$      {type:'math', display:true}
  //   mathBracket           \[…\]      {type:'math', display:true}
  //   mathParen             \(…\)      {type:'math', display:false}
  //   mathDollar            $…$        {type:'math', display:false}
  //   boldStars / boldUnder **…**/__…__ {type:'strong'}
  //   emStar / emUnder      *…* / _…_  {type:'em'}
  //   linkText + linkHref   [t](h)     {type:'link'}
  const INLINE =
    /(?<tick>`+)(?<code>[^`]+?)\k<tick>|\$\$(?<mathDollars>[\s\S]+?)\$\$|\\\[(?<mathBracket>[\s\S]+?)\\\]|\\\((?<mathParen>[\s\S]+?)\\\)|\$(?!\s)(?<mathDollar>[^$\n]+?)(?<!\s)\$(?!\d)|\*\*(?<boldStars>[\s\S]+?)\*\*|__(?<boldUnder>[\s\S]+?)__|\*(?<emStar>[^*]+?)\*|_(?<emUnder>[^_]+?)_|\[(?<linkText>[^\]]+?)\]\((?<linkHref>[^)\s]+)\)/;

  function parse(md) {
    const text = String(md == null ? "" : md).replace(/\r\n/g, "\n");
    return parseBlocks(text.split("\n"));
  }

  // Incremental parse for a growing (streaming) text. Reuses the previous
  // parse's blocks for the stable source prefix and re-parses only the tail,
  // so total stream cost is O(answer) instead of O(answer²).
  //
  // Stability rule (proved against this grammar; see the incremental test):
  // reuse only blocks strictly BEFORE the last two, and only when the reused
  // source ends at a blank line. Why that is airtight here:
  //  - an UNCLOSED fence/math block consumes every remaining line, so it is
  //    always the LAST block — closed constructs only, in the reused prefix;
  //  - every other construct (paragraph, list, table, quote) stops at a blank
  //    line, and no parsing decision looks past one (the table lookahead sees
  //    at most the next line, which at the cut is the blank itself);
  //  - late-forming constructs (a paragraph becoming a table when its
  //    separator row streams in, a list gaining items) live in the re-parsed
  //    last-two-block tail.
  // Any prefix mismatch (mid-stream rewrite) falls back to a full parse.
  //
  // parseStream(prevState|null, md) -> { blocks, state } — state is opaque;
  // reused blocks keep identity, so firstChangedBlock's `===` fast path makes
  // the renderer's diff O(tail) too.
  function parseStream(prev, md) {
    const text = String(md == null ? "" : md).replace(/\r\n/g, "\n");
    const full = () => {
      const starts = [];
      const blocks = parseBlocks(text.split("\n"), starts);
      return { blocks, state: { text, blocks, starts } };
    };
    if (!prev || prev.blocks.length < 3) return full();
    const cut = prev.starts[prev.blocks.length - 2]; // first line of the unstable tail
    const lines = prev.text.split("\n");
    if (cut <= 0 || !/^\s*$/.test(lines[cut - 1])) return full();
    const prefix = lines.slice(0, cut).join("\n") + "\n";
    if (!text.startsWith(prefix)) return full(); // rewrite — correctness net
    const tailStarts = [];
    const tailBlocks = parseBlocks(text.slice(prefix.length).split("\n"), tailStarts);
    const keep = prev.blocks.length - 2;
    const blocks = prev.blocks.slice(0, keep).concat(tailBlocks);
    const starts = prev.starts.slice(0, keep).concat(tailStarts.map((s) => s + cut));
    return { blocks, state: { text, blocks, starts } };
  }

  function isBlockStart(line) {
    return (
      FENCE.test(line) ||
      HEADING.test(line) ||
      LIST.test(line) ||
      QUOTE.test(line) ||
      HR.test(line) ||
      MATH_FENCE.test(line)
    );
  }

  // TeX→inline conversion is pure in the formula text (display mode only
  // tags the node — toInline never sees it), so memoize per formula: a
  // streaming re-parse re-converts every formula seen so far on every flush
  // otherwise. Clear-on-full cap: worst case degrades to exactly the no-memo
  // cost, never worse. Cached inline arrays are shared between nodes — the
  // renderer treats the AST as immutable.
  const texMemo = new Map();
  const TEX_MEMO_MAX = 500;
  function texInline(tex) {
    let inline = texMemo.get(tex);
    if (inline === undefined) {
      if (texMemo.size >= TEX_MEMO_MAX) texMemo.clear();
      inline = texUnicode ? texUnicode.toInline(tex) : [{ type: "text", value: tex }];
      texMemo.set(tex, inline);
    }
    return inline;
  }

  function mathNode(tex, display) {
    tex = tex.trim();
    return { type: "math", display: !!display, tex, inline: texInline(tex) };
  }

  // `startsOut`, when given, records each top-level block's starting line
  // index (parseStream's cut points). Nested calls (blockquote children)
  // don't pass it — inner structure is irrelevant to the cut.
  function parseBlocks(lines, startsOut) {
    const blocks = [];
    const mark = (at) => {
      if (startsOut) startsOut.push(at);
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const blockStart = i;

      const fence = line.match(FENCE);
      if (fence) {
        const lang = fence[1].trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; // consume closing fence (no-op if we ran off the end — unclosed fence)
        mark(blockStart);
        blocks.push({ type: "code", lang, text: buf.join("\n") });
        continue;
      }
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }
      const h = line.match(HEADING);
      if (h) {
        mark(blockStart);
        blocks.push({ type: "heading", level: h[1].length, inline: parseInlineLines(h[2]) });
        i++;
        continue;
      }
      if (HR.test(line)) {
        mark(blockStart);
        blocks.push({ type: "hr" });
        i++;
        continue;
      }
      if (QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(QUOTE, ""));
        mark(blockStart);
        blocks.push({ type: "blockquote", children: parseBlocks(buf) });
        continue;
      }
      if (LIST.test(line)) {
        const listLines = [];
        while (i < lines.length && LIST.test(lines[i])) listLines.push(lines[i++]);
        mark(blockStart);
        blocks.push(parseList(listLines));
        continue;
      }
      // Pipe table: a header row followed by a |---|---| separator row.
      if (
        line.indexOf("|") !== -1 &&
        i + 1 < lines.length &&
        lines[i + 1].indexOf("|") !== -1 &&
        TABLE_SEP.test(lines[i + 1])
      ) {
        const header = splitTableRow(line).map(inlineChildren);
        i += 2; // header + separator
        const rows = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && !/^\s*$/.test(lines[i])) {
          rows.push(splitTableRow(lines[i++]).map(inlineChildren));
        }
        mark(blockStart);
        blocks.push({ type: "table", header, rows });
        continue;
      }
      // Display-math fence: $$…$$ / \[…\] on its own line(s). Multi-line works
      // like FENCE: an unclosed opener runs to the end of input (streaming).
      const mopen = line.match(MATH_FENCE);
      if (mopen) {
        const close = mopen[1] === "$$" ? "$$" : "\\]";
        const rest = mopen[2];
        const closeAt = rest.indexOf(close);
        if (closeAt !== -1) {
          if (/^\s*$/.test(rest.slice(closeAt + close.length))) {
            mark(blockStart);
            blocks.push(mathNode(rest.slice(0, closeAt), true));
            i++;
            continue;
          }
          // prose after the closer on the same line — fall through and let the
          // paragraph + inline rules handle the whole line
        } else {
          const buf = [rest];
          i++;
          while (i < lines.length && lines[i].indexOf(close) === -1) buf.push(lines[i++]);
          if (i < lines.length) {
            const at = lines[i].indexOf(close);
            buf.push(lines[i].slice(0, at));
            const after = lines[i].slice(at + close.length);
            if (/^\s*$/.test(after)) i++;
            else lines[i] = after; // rare: prose after the closer — reprocess it
          }
          mark(blockStart);
          blocks.push(mathNode(buf.join("\n"), true));
          continue;
        }
      }
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i]))
        buf.push(lines[i++]);
      mark(blockStart);
      blocks.push({ type: "paragraph", inline: parseInlineLines(buf.join("\n")) });
    }
    return blocks;
  }

  // Indentation-aware list builder: deeper-indented items become the previous
  // item's nested child list. Items are {inline, children: list|null}.
  function parseList(listLines) {
    const rows = listLines.map((l) => {
      const m = l.match(LIST);
      return {
        indent: m[1].replace(/\t/g, "  ").length,
        ordered: ORDERED.test(l),
        text: l.slice(m[0].length),
      };
    });
    let pos = 0;
    function level(indent) {
      const list = { type: "list", ordered: rows[pos].ordered, items: [] };
      while (pos < rows.length) {
        const r = rows[pos];
        if (r.indent < indent) break; // parent level resumes
        if (r.indent > indent && list.items.length) {
          list.items[list.items.length - 1].children = level(r.indent);
          continue;
        }
        list.items.push({ inline: parseInlineLines(r.text), children: null });
        pos++;
      }
      return list;
    }
    const top = level(rows[0].indent);
    while (pos < rows.length) {
      // malformed shallower leftovers — keep them rather than dropping text
      top.items.push({ inline: parseInlineLines(rows[pos].text), children: null });
      pos++;
    }
    return top;
  }

  // "| a | b |" -> ["a", "b"] (outer pipes optional)
  function splitTableRow(line) {
    let s = line.trim();
    if (s[0] === "|") s = s.slice(1);
    if (s[s.length - 1] === "|") s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
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
      const g = m.groups;
      if (g.code != null) out.push({ type: "code", value: g.code });
      else if (g.mathDollars != null || g.mathBracket != null)
        out.push(mathNode(g.mathDollars != null ? g.mathDollars : g.mathBracket, true));
      else if (g.mathParen != null || g.mathDollar != null)
        out.push(mathNode(g.mathParen != null ? g.mathParen : g.mathDollar, false));
      else if (g.boldStars != null || g.boldUnder != null)
        out.push({
          type: "strong",
          children: inlineChildren(g.boldStars != null ? g.boldStars : g.boldUnder),
        });
      else if (g.emStar != null || g.emUnder != null)
        out.push({ type: "em", children: inlineChildren(g.emStar != null ? g.emStar : g.emUnder) });
      else if (g.linkText != null)
        out.push({ type: "link", text: g.linkText, href: safeHref(g.linkHref) });
      rest = rest.slice(m.index + m[0].length);
    }
  }

  // Only http(s) links get a real href; everything else (javascript:, data:, …)
  // renders as inert text. This is the markdown half of the XSS guard.
  function safeHref(href) {
    return /^https?:\/\//i.test(href) ? href : null;
  }

  // Deep equality over AST nodes (plain arrays/objects/primitives only).
  function eq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const ka = Object.keys(a);
      if (ka.length !== Object.keys(b).length) return false;
      for (const k of ka) if (!eq(a[k], b[k])) return false;
      return true;
    }
    return false;
  }

  // Index of the first block that differs between two parses — the streaming
  // renderer rebuilds DOM only from here. A stream appends, so this is almost
  // always the last block; a full rewrite (Gemini revision) returns 0.
  function firstChangedBlock(prevBlocks, nextBlocks) {
    const n = Math.min(prevBlocks.length, nextBlocks.length);
    for (let i = 0; i < n; i++) {
      if (!eq(prevBlocks[i], nextBlocks[i])) return i;
    }
    return n; // one is a prefix of the other (or they're identical)
  }

  return { parse, parseStream, firstChangedBlock };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.markdownAst;
