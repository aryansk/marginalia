// tex-unicode.js — pure: convert a TeX math string (the content between $…$,
// $$…$$, \(…\), \[…\] delimiters that LLMs emit) into renderable inline nodes.
// No DOM: output reuses the markdown AST inline shapes plus two new ones —
//   {type:'text',value} | {type:'sub',children} | {type:'sup',children}
// — which content/markdown.js renders as text / <sub> / <sup>.
//
// Single left-to-right tokenizer (no global replaces): symbol commands come
// from the generated tables (core/tex-tables.js), structural commands
// (\frac, \text, \left, _{}/^{}) are grammar here. The invariant is that
// nothing is ever dropped or mangled: a command we don't know is emitted as
// literal text, so worst case the user reads the original TeX.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};
// Browser: core/tex-tables.js loaded earlier set GA.core.texTables. Node/tests:
// require it so this module stays importable on its own.
var texTables =
  GA.core.texTables || (typeof require !== "undefined" ? require("./tex-tables.js") : null);

GA.core.texUnicode = (function () {
  const SYMBOLS = texTables.symbols;
  const ALPHABETS = texTables.alphabets;

  // Font commands -> alphabet table key (\mathcal{H} -> script H, …).
  const FONT_CMDS = {
    mathcal: "cal",
    mathscr: "cal",
    cal: "cal",
    mathbb: "bb",
    bb: "bb",
    mathfrak: "frak",
    frak: "frak",
  };
  // Wrapper commands whose argument is kept as-is (they only change font/mode).
  const TEXT_CMDS = {
    text: 1,
    textrm: 1,
    textbf: 1,
    textit: 1,
    texttt: 1,
    mathrm: 1,
    mathit: 1,
    mathbf: 1,
    mathsf: 1,
    mathtt: 1,
    operatorname: 1,
  };
  // TeX operator names render as themselves (upright in real TeX): \log x -> log x.
  const FUNC_CMDS = {};
  (
    "log ln lg exp sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh " +
    "max min sup inf lim liminf limsup det gcd dim deg arg ker hom Pr mod"
  )
    .split(" ")
    .forEach((f) => (FUNC_CMDS[f] = 1));
  // Sizing/fencing commands: strip to the delimiter that follows them.
  const SIZE_CMDS = {
    left: 1,
    right: 1,
    middle: 1,
    big: 1,
    Big: 1,
    bigg: 1,
    Bigg: 1,
    bigl: 1,
    bigr: 1,
    Bigl: 1,
    Bigr: 1,
    biggl: 1,
    biggr: 1,
    biggm: 1,
  };
  // Control symbols: \, \; \: are thin spaces, \! is negative space (dropped).
  const SPACE_SYMBOLS = { ",": " ", ";": " ", ":": " ", " ": " " };
  const LITERAL_SYMBOLS = {
    "{": "{",
    "}": "}",
    "|": "‖",
    $: "$",
    "%": "%",
    "&": "&",
    "#": "#",
    _: "_",
  };
  const MAX_DEPTH = 40; // beyond this, `{` is literal — guards the recursion

  function toInline(tex) {
    const cur = { s: String(tex == null ? "" : tex), pos: 0 };
    return parseRun(cur, 0, false);
  }

  // Parse until end of input or, insideGroup, the matching `}`.
  function parseRun(cur, depth, insideGroup) {
    const out = [];
    const s = cur.s;
    while (cur.pos < s.length) {
      const ch = s[cur.pos];
      if (ch === "}") {
        cur.pos++;
        if (insideGroup) return out;
        pushText(out, "}"); // unbalanced closer — keep it visible
        continue;
      }
      if (ch === "{") {
        cur.pos++;
        if (depth < MAX_DEPTH)
          pushAll(out, parseRun(cur, depth + 1, true)); // transparent group
        else pushText(out, "{");
        continue;
      }
      if (ch === "_" || ch === "^") {
        cur.pos++;
        out.push({ type: ch === "_" ? "sub" : "sup", children: parseArg(cur, depth + 1) });
        continue;
      }
      if (ch === "\\") {
        command(cur, out, depth);
        continue;
      }
      // Plain run up to the next special char; collapse whitespace (newlines in
      // multi-line display math become single spaces).
      const m = /^[^{}_^\\]+/.exec(s.slice(cur.pos));
      cur.pos += m[0].length;
      pushText(out, m[0].replace(/\s+/g, " "));
    }
    return out;
  }

  // One argument: a {group}, a \command, or a single character.
  function parseArg(cur, depth) {
    const s = cur.s;
    if (cur.pos >= s.length) return [];
    if (s[cur.pos] === "{") {
      cur.pos++;
      return parseRun(cur, depth, true);
    }
    if (s[cur.pos] === "\\") {
      const out = [];
      command(cur, out, depth);
      return out;
    }
    return [{ type: "text", value: s[cur.pos++] }];
  }

  function command(cur, out, depth) {
    const s = cur.s;
    const m = /^\\([a-zA-Z]+)/.exec(s.slice(cur.pos));
    if (!m) {
      // Control symbol: \{ \} \, \; \! \\ …
      const c = s[cur.pos + 1];
      cur.pos += c === undefined ? 1 : 2;
      if (c === undefined) pushText(out, "\\");
      else if (LITERAL_SYMBOLS[c] !== undefined) pushText(out, LITERAL_SYMBOLS[c]);
      else if (SPACE_SYMBOLS[c] !== undefined) pushText(out, SPACE_SYMBOLS[c]);
      else if (c === "!")
        pushText(out, ""); // negative thin space — drop
      else if (c === "\\")
        pushText(out, " "); // row break
      else pushText(out, "\\" + c); // unknown — keep literal
      return;
    }
    const name = m[1];
    cur.pos += 1 + name.length;

    if (FONT_CMDS[name]) {
      const table = ALPHABETS[FONT_CMDS[name]];
      const arg = flatText(parseArg(cur, depth + 1));
      pushText(
        out,
        Array.from(arg)
          .map((c) => table[c] || c)
          .join(""),
      );
      return;
    }
    if (TEXT_CMDS[name]) {
      if (s[cur.pos] === "*") cur.pos++; // \operatorname* variant
      pushAll(out, parseArg(cur, depth + 1));
      return;
    }
    if (SIZE_CMDS[name]) {
      // Consume the delimiter that follows: ( ) [ ] | . \{ \} \| ; `.` is
      // TeX's invisible delimiter and renders as nothing.
      const d = /^\s*(\\[{}|]|[()[\]|.])/.exec(s.slice(cur.pos));
      if (d) {
        cur.pos += d[0].length;
        const delim = d[1].replace(/^\\/, "");
        if (delim !== ".") pushText(out, delim);
      }
      return;
    }
    if (name === "frac" || name === "tfrac" || name === "dfrac") {
      const num = parseArg(cur, depth + 1);
      const den = parseArg(cur, depth + 1);
      pushOperand(out, num);
      pushText(out, "/");
      pushOperand(out, den);
      return;
    }
    if (name === "sqrt") {
      pushText(out, "√");
      pushOperand(out, parseArg(cur, depth + 1));
      return;
    }
    if (name === "bmod") {
      pushText(out, " mod ");
      return;
    }
    if (name === "pmod") {
      pushText(out, " (mod ");
      pushAll(out, parseArg(cur, depth + 1));
      pushText(out, ")");
      return;
    }
    if (FUNC_CMDS[name]) {
      pushText(out, name);
      return;
    }
    const sym = SYMBOLS["\\" + name];
    if (sym !== undefined) {
      pushText(out, sym);
      return;
    }
    pushText(out, "\\" + name); // unknown command — never dropped
  }

  // A frac/sqrt operand gets parens unless it is unambiguous on its own:
  // a single code point (1/m, √x) or a bare digit run (1/22). "2m" or "a+b"
  // read wrong without parens (1/(2m), (a+b)/c).
  function pushOperand(out, nodes) {
    const simple =
      nodes.length === 0 ||
      (nodes.length === 1 &&
        nodes[0].type === "text" &&
        (Array.from(nodes[0].value).length === 1 || /^\d+$/.test(nodes[0].value)));
    if (simple) {
      pushAll(out, nodes);
      return;
    }
    pushText(out, "(");
    pushAll(out, nodes);
    pushText(out, ")");
  }

  function flatText(nodes) {
    let s = "";
    for (const n of nodes) {
      if (n.type === "text") s += n.value;
      else if (n.children) s += flatText(n.children);
    }
    return s;
  }

  // Append text, merging with a trailing text node so runs stay one node.
  // Whitespace runs collapse at the merge boundary too ("\bmod p" emits
  // " mod " next to the source's own space).
  function pushText(out, value) {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.value = (last.value + value).replace(/\s{2,}/g, " ");
    else out.push({ type: "text", value });
  }

  function pushAll(out, nodes) {
    for (const n of nodes) {
      if (n.type === "text") pushText(out, n.value);
      else out.push(n);
    }
  }

  return { toInline };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.texUnicode;
