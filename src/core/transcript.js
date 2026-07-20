// transcript.js — pure Markdown renderer for a captured conversation + its
// threads. Takes the DECOMPRESSED convo record (the export path in T-012 is
// the sole decompress site) plus that conversation's thread array, and returns
// a NotebookLM/Obsidian-ready Markdown string. No DOM, no storage, no
// CompressionStream — build ONLY strings, never HTML.
//
// Two jobs beyond layout:
//  - PREFIX-DEDUPE (fix F3): capture-on-create can store a mid-stream partial
//    of an answer that a later capture stores completed. Consecutive same-role
//    turns where one normalized text is a strict prefix of the other render
//    only the LONGER. Regenerated (non-prefix) answers are a documented
//    limitation — both render; dropping a "maybe duplicate" would silently
//    lose real content, which is worse than the duplicate it cleans.
//  - Thread placement: a thread lands after the turn whose fp matches its
//    recorded anchor fingerprint (FIRST matching turn — duplicate fps are
//    expected for repeated identical messages). A miss (the anchor points at
//    a dropped/upgraded mid-stream fp) falls back to quote containment —
//    first same-role turn whose text contains the quoted exact. Still no
//    match (legacy null anchor, quote nowhere on record) routes it to a
//    trailing "Unanchored notes" section — never silently lost. A hash
//    collision is documented-safe in turn-id.js for anchoring; here it could
//    at worst file a note under a same-length twin turn, never lose it.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.transcript = (function () {
  const ROLE_HEADING = { user: "You", model: "Assistant" };

  function norm(text) {
    return GA.core.turnId.normalize(text);
  }

  // ---- text hygiene ---------------------------------------------------
  // Captured text must not smuggle raw HTML or fake document structure into
  // the Markdown. `<` is backslash-escaped (CommonMark renders `\<` as a
  // literal, so `<script>` can never pass through as markup), and a line that
  // would open a heading or a blockquote gets its marker escaped so turn text
  // cannot forge sections or nest into our callouts.
  function mdBlock(text) {
    return String(text == null ? "" : text)
      .replace(/\r\n?/g, "\n")
      .replace(/</g, "\\<")
      .replace(/^([ \t]{0,3})([#>])/gm, "$1\\$2");
  }

  // Single-line fields (title, quote, metadata): collapse whitespace first so
  // a stray newline can't break out of the heading or list item.
  function mdInline(text) {
    return mdBlock(norm(text));
  }

  // Prefix every line with "> " so multi-line thread content stays inside its
  // blockquote callout.
  function quote(text) {
    return text
      .split("\n")
      .map((l) => (l ? "> " + l : ">"))
      .join("\n");
  }

  // Pure: formats the RECORDED capture time, never reads the clock. UTC so
  // the same record renders identically everywhere.
  function formatDate(ts) {
    if (ts == null) return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  // ---- turns ------------------------------------------------------------
  function sortedTurns(convo) {
    const raw = convo && Array.isArray(convo.turns) ? convo.turns : [];
    return raw
      .filter((t) => !!t && typeof t === "object")
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const ao = typeof a.t.order === "number" ? a.t.order : Infinity;
        const bo = typeof b.t.order === "number" ? b.t.order : Infinity;
        return ao - bo || a.i - b.i;
      })
      .map((e) => e.t);
  }

  // Fix F3. Compare each turn against the LAST KEPT one so a chain of
  // partials (A, AB, ABC) collapses to its longest form. Scope is deliberate:
  // consecutive + same (truthy) role + strict prefix ONLY — no fuzzy matching,
  // no deduping across gaps, identical texts both survive (repeated identical
  // messages are legitimate and survive capture's multiset merge).
  function dedupeTurns(turns) {
    const kept = [];
    for (const cur of turns) {
      const prev = kept[kept.length - 1];
      if (prev && prev.role && prev.role === cur.role) {
        const a = norm(prev.text);
        const b = norm(cur.text);
        if (a && b && a !== b) {
          if (b.indexOf(a) === 0)
            kept.pop(); // prev was a stale partial of cur
          else if (a.indexOf(b) === 0) continue; // cur is a stale partial of prev
        }
      }
      kept.push(cur);
    }
    return kept;
  }

  function headingFor(role) {
    return ROLE_HEADING[role] || "Message";
  }

  // ---- threads ------------------------------------------------------------
  function speakerFor(role) {
    return role === "user" ? "You" : role === "model" ? "Assistant" : "Note";
  }

  function calloutFor(thread) {
    const parts = [];
    const exact = thread && thread.selector ? thread.selector.exact : null;
    parts.push(norm(exact) ? '"' + mdInline(exact) + '"' : "_(no highlighted text recorded)_");
    const msgs = thread && Array.isArray(thread.messages) ? thread.messages : [];
    for (const raw of msgs) {
      const m = raw && typeof raw === "object" ? raw : {};
      parts.push("**" + speakerFor(m.role) + ":** " + mdBlock(m.text));
    }
    return quote("[!note] Annotation\n" + parts.join("\n\n"));
  }

  // Placement fallback (stale-anchor recovery): a thread created while its
  // turn was still streaming recorded the PARTIAL turn's fingerprint. The
  // capture-side stale-partial upgrade replaces that fingerprint in the index
  // with the completed turn's, and render-time prefix-dedupe can drop the
  // partial too — either way the fp match misses. The quoted text still
  // identifies the turn: place the thread under the FIRST turn (of the
  // anchor's recorded role, when present) whose text CONTAINS the quote.
  // Containment of the exact quote is strong evidence; anything weaker keeps
  // falling through to Unanchored notes.
  function quoteFallback(thread, turns) {
    const exact = norm(thread && thread.selector ? thread.selector.exact : "");
    if (!exact) return -1;
    const role = thread.anchor && thread.anchor.role;
    for (let i = 0; i < turns.length; i++) {
      if (role && turns[i].role !== role) continue;
      if (norm(turns[i].text).indexOf(exact) !== -1) return i;
    }
    return -1;
  }

  // Deterministic order for threads sharing a turn and for the unanchored
  // list: createdAt, then original array position for ties/missing stamps.
  function orderedThreads(threads) {
    const list = Array.isArray(threads) ? threads.filter(Boolean) : [];
    return list
      .map((th, i) => ({ th, i }))
      .sort((a, b) => {
        const ca = typeof a.th.createdAt === "number" ? a.th.createdAt : Infinity;
        const cb = typeof b.th.createdAt === "number" ? b.th.createdAt : Infinity;
        return ca - cb || a.i - b.i;
      })
      .map((e) => e.th);
  }

  // ---- document -----------------------------------------------------------
  function build(convo, threads) {
    const record = convo && typeof convo === "object" ? convo : {};
    const turns = dedupeTurns(sortedTurns(record));
    const ordered = orderedThreads(threads);

    // Attach each thread to the FIRST surviving turn whose fp matches its
    // recorded anchor fingerprint; everything else trails as unanchored.
    const byTurn = new Map();
    const unanchored = [];
    for (const th of ordered) {
      const fp = th.anchor && th.anchor.turn;
      let at = -1;
      if (fp) {
        for (let j = 0; j < turns.length; j++) {
          if (GA.core.turnId.sameFingerprint(fp, turns[j].fp)) {
            at = j;
            break;
          }
        }
      }
      if (at === -1) at = quoteFallback(th, turns);
      if (at === -1) {
        unanchored.push(th);
      } else {
        if (!byTurn.has(at)) byTurn.set(at, []);
        byTurn.get(at).push(th);
      }
    }

    const out = [];
    out.push("# " + (mdInline(record.title) || "Captured conversation"));
    out.push("");
    // Framing (brief ruling): this is a CAPTURED transcript — the turns saved
    // while annotating — never a claim of full-conversation fidelity.
    out.push(
      "*Captured transcript — the turns saved while annotating this conversation; it may not span the full exchange.*",
    );
    out.push("");
    const meta = [];
    if (norm(record.provider)) meta.push("- Provider: " + mdInline(record.provider));
    const when = formatDate(record.capturedAt);
    if (when) meta.push("- Captured: " + when);
    if (norm(record.url)) meta.push("- Source: " + mdInline(record.url));
    if (meta.length) {
      out.push(meta.join("\n"));
      out.push("");
    }
    out.push("---");
    out.push("");

    for (let k = 0; k < turns.length; k++) {
      out.push("## " + headingFor(turns[k].role));
      out.push("");
      if (norm(turns[k].text)) {
        out.push(mdBlock(turns[k].text));
        out.push("");
      }
      const anns = byTurn.get(k) || [];
      for (const ann of anns) {
        out.push(calloutFor(ann));
        out.push("");
      }
    }

    if (unanchored.length) {
      out.push("## Unanchored notes");
      out.push("");
      for (const un of unanchored) {
        out.push(calloutFor(un));
        out.push("");
      }
    }

    return (
      out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() + "\n"
    );
  }

  return { build };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.transcript;
