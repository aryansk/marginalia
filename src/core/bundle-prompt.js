// bundle-prompt.js — pure composition for the cross-conversation synthesis
// flow (panel "All chats" tab): resolve the LLM turn a standalone label
// anchors, bundle the curated items into ONE prompt for the active provider,
// and format the downloadable Markdown document around the model's output.
//
// Decompression discipline: resolveTurn inflates AT MOST the one blob the
// label's fingerprint addresses (blobs are per-message — see convo-capture);
// the whole-conversation decode (convo-repair.loadDecoded) is the caller's
// fallback for fingerprint misses, and resolveFromDecoded covers that path
// with the same quote-containment evidence transcript.js uses for placement.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.bundlePrompt = (function () {
  function norm(text) {
    return String(text == null ? "" : text)
      .replace(/\s+/g, " ")
      .trim();
  }

  function clip(text, max) {
    const s = String(text == null ? "" : text);
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  // resolveTurn(rawConvo, record) -> Promise<string|null>. Fingerprint match
  // against the RAW convo index, then inflate only that turn's blob. null on
  // any miss (no record, no fp hit, missing/corrupt blob) — never a throw.
  async function resolveTurn(rawConvo, record) {
    const fp = record && record.anchor && record.anchor.turn;
    if (!fp || !rawConvo) return null;
    const turns = Array.isArray(rawConvo.turns) ? rawConvo.turns : [];
    const blobs =
      rawConvo.blobs && typeof rawConvo.blobs === "object" && !Array.isArray(rawConvo.blobs)
        ? rawConvo.blobs
        : {};
    for (const t of turns) {
      if (!t || !t.fp || !GA.core.turnId.sameFingerprint(fp, t.fp)) continue;
      const blob = blobs[t.fp.hash + ":" + t.fp.len];
      if (blob == null) return null; // indexed but blob missing — fall back
      try {
        return await GA.core.compress.b64ToText(blob);
      } catch (e) {
        return null; // corrupt blob — fall back (repair happens in loadDecoded)
      }
    }
    return null;
  }

  // resolveFromDecoded(decodedTurns, record) -> string|null. The fallback over
  // ALREADY-decoded turns: fingerprint first, then first same-role turn whose
  // text CONTAINS the recorded quote (transcript.js's placement evidence).
  function resolveFromDecoded(decodedTurns, record) {
    const turns = Array.isArray(decodedTurns) ? decodedTurns.filter(Boolean) : [];
    const at = GA.core.outline.locateThread(record, turns);
    return at === -1 ? null : turns[at].text || null;
  }

  // resolveText(rawConvo, getDecoded, record) -> Promise<string>. The WHOLE
  // resolution ladder for a labeled turn, floor included: selective blob
  // decode → whole-conversation decode (getDecoded is a lazy thunk, so that
  // expensive path runs only on a fingerprint miss) → the record's stored
  // section/quote text. Never rejects, never returns null — a label always
  // contributes SOMETHING to the bundle.
  async function resolveText(rawConvo, getDecoded, record) {
    let text = await resolveTurn(rawConvo, record);
    if (text == null && getDecoded) {
      const decoded = await getDecoded();
      text = decoded ? resolveFromDecoded(decoded.turns, record) : null;
    }
    if (text == null)
      text =
        (record && record.section) || (record && record.selector && record.selector.exact) || "";
    return text;
  }

  // The margin discussion of a thread, in core/prompt.js's Me:/You: convention
  // (error notices skipped — they aren't part of the conversation).
  function threadContent(record) {
    return ((record && record.messages) || [])
      .filter((m) => m && !m.error && m.text)
      .map((m) => (m.role === "user" ? "Me: " : "You: ") + m.text)
      .join("\n");
  }

  // compose({ instruction, items, providerLabel, maxItemChars }) -> prompt.
  // items: [{ kind: "thread"|"turn", title?, labels?, snippet?, content }].
  function compose(opts) {
    const items = (opts && opts.items) || [];
    const max = (opts && opts.maxItemChars) || 8000;
    const who = opts && opts.providerLabel ? "you (" + opts.providerLabel + ")" : "you";
    const lines = [];
    lines.push(
      "I've collected " +
        items.length +
        " excerpt" +
        (items.length === 1 ? "" : "s") +
        " from my past conversations with " +
        who +
        ". Each item is either a full answer I labeled, or a margin discussion " +
        "we had about a highlighted passage.",
    );
    lines.push("");
    items.forEach(function (it, i) {
      lines.push("--- Item " + (i + 1) + " ---");
      if (it.title) lines.push("Conversation: " + norm(it.title));
      if (it.labels && it.labels.length) lines.push("Labels: " + it.labels.join(", "));
      if (it.kind === "turn") {
        lines.push("Labeled answer:");
      } else {
        if (it.snippet) lines.push('Highlighted: "' + norm(it.snippet) + '"');
        lines.push("Discussion:");
      }
      lines.push('"""');
      lines.push(clip(it.content || "", max));
      lines.push('"""');
      lines.push("");
    });
    lines.push("My request, considering all items together: " + ((opts && opts.instruction) || ""));
    return lines.join("\n");
  }

  // downloadDoc({ output, instruction, sources, date }) -> the .md file body:
  // a small provenance header, then the model's output verbatim (it is already
  // Markdown — no second LLM round-trip).
  // sources: [{ kind, title?, labels?, snippet? }]
  function downloadDoc(opts) {
    const o = opts || {};
    const out = [];
    out.push("# Synthesis");
    out.push("");
    if (o.date) out.push("- Generated: " + o.date);
    if (o.instruction) out.push("- Prompt: " + norm(o.instruction));
    const sources = o.sources || [];
    if (sources.length) {
      out.push("- Sources:");
      sources.forEach(function (s) {
        const bits = [];
        bits.push(s.kind === "turn" ? "labeled answer" : "thread");
        if (s.snippet) bits.push('"' + norm(s.snippet) + '"');
        if (s.title) bits.push("in “" + norm(s.title) + "”");
        if (s.labels && s.labels.length) bits.push("[" + s.labels.join(", ") + "]");
        out.push("  - " + bits.join(" — "));
      });
    }
    out.push("");
    out.push("---");
    out.push("");
    out.push(String(o.output == null ? "" : o.output));
    return out.join("\n");
  }

  return { resolveTurn, resolveFromDecoded, resolveText, threadContent, compose, downloadDoc };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.bundlePrompt;
