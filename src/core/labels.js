// labels.js — pure label grammar: the /label slash command, name normalization
// and validation, dotted-namespace containment ("project" selects
// "project.ux.nav"), picker search, and namespace grouping. No DOM, no
// storage — every consumer (thread-ui intercept, controller policy, panel
// picker) shares these rules so a label written in one surface always matches
// in another.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.labels = (function () {
  const USAGE = 'Usage: /label "name" — e.g. /label project.ux';

  // normalize(name) -> canonical label string, or null when invalid.
  // Canonical = lowercase, whitespace collapsed, segments trimmed. Dots are
  // namespace separators, so an empty segment (leading/trailing/double dot)
  // invalidates the whole name rather than silently reshaping it. A double
  // quote is rejected outright: it's the arg-quoting character, so a label
  // containing one (reachable only via backup import / hand-edited storage)
  // could never round-trip through the editors.
  function normalize(name) {
    const s = String(name == null ? "" : name)
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (!s || s.indexOf('"') >= 0) return null;
    const segs = s.split(".").map((p) => p.trim());
    if (segs.some((p) => !p)) return null;
    return segs.join(".");
  }

  // Args are quoted strings (spaces allowed inside) or bare whitespace-split
  // tokens, freely mixed: /label "needs review" project.ux todo
  function tokenize(text) {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(text))) out.push(m[1] != null ? m[1] : m[2]);
    return out;
  }

  // parseList(text) -> { labels: [...], invalid: [...] } — normalized, deduped,
  // order-preserving. Shared by the command below and the in-place editor.
  function parseList(text) {
    const labels = [];
    const invalid = [];
    for (const tok of tokenize(String(text == null ? "" : text))) {
      const n = normalize(tok);
      if (n == null) invalid.push(tok);
      else if (labels.indexOf(n) < 0) labels.push(n);
    }
    return { labels, invalid };
  }

  // parseCommand(text) -> null (not a /label command — send to the LLM)
  //                     | { labels: [...] }
  //                     | { error: "..." } (it IS the command, but malformed —
  //                       never falls through to the LLM).
  function parseCommand(text) {
    const t = String(text == null ? "" : text).trim();
    const m = /^\/label\b([\s\S]*)$/i.exec(t);
    if (!m) return null;
    const parsed = parseList(m[1]);
    if (parsed.invalid.length) return { error: invalidMessage(parsed.invalid[0]) + " " + USAGE };
    if (!parsed.labels.length) return { error: USAGE };
    return { labels: parsed.labels };
  }

  // The one rendering of "that name is not a valid label" — every surface
  // (command errors, both editors) toasts this same sentence.
  function invalidMessage(name) {
    return 'Invalid label "' + name + '".';
  }

  // merge(existing, added) -> union, existing order first, deduped.
  function merge(existing, added) {
    const out = [];
    for (const l of (existing || []).concat(added || [])) {
      if (l && out.indexOf(l) < 0) out.push(l);
    }
    return out;
  }

  // covers(prefix, label) -> namespace containment, prefix first:
  // covers("project", "project.ux.nav") === true. A picked prefix covers the
  // label itself and everything under it, but never "projector".
  function covers(prefix, label) {
    if (!prefix || !label) return false;
    return label === prefix || label.indexOf(prefix + ".") === 0;
  }

  // searchMatch(label, typed) -> picker filter: the typed text must start at a
  // segment boundary ("ux" matches "project.ux.nav"; "x.na" does not, but
  // "ux.na" does). Empty query matches all.
  function searchMatch(label, typed) {
    const t = String(typed == null ? "" : typed)
      .trim()
      .toLowerCase();
    if (!t) return true;
    if (!label) return false;
    return ("." + label).indexOf("." + t) >= 0;
  }

  // groupByNamespace(labels) -> [{ ns, labels: [...] }], namespace = everything
  // before the last dot ("" for bare labels). Groups and members sorted;
  // the bare group renders last — named namespaces are the organizing signal.
  function groupByNamespace(labels) {
    const by = new Map();
    for (const l of labels || []) {
      if (!l) continue;
      const dot = l.lastIndexOf(".");
      const ns = dot < 0 ? "" : l.slice(0, dot);
      if (!by.has(ns)) by.set(ns, []);
      if (by.get(ns).indexOf(l) < 0) by.get(ns).push(l);
    }
    const groups = Array.from(by.entries(), ([ns, ls]) => ({ ns, labels: ls.sort() }));
    groups.sort((a, b) => {
      if (!a.ns !== !b.ns) return a.ns ? -1 : 1;
      return a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0;
    });
    return groups;
  }

  return {
    normalize,
    parseList,
    parseCommand,
    invalidMessage,
    merge,
    covers,
    searchMatch,
    groupByNamespace,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.labels;
