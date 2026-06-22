// parser.js — pure parser for Gemini's StreamGenerate (batchexecute) responses.
// No DOM, no network: given the accumulated response text, return the answer
// string (or null). Extracted from client.js so it can be unit-tested exhaustively.
//
// The answer text grows across frames (each frame carries the full answer so
// far), while trailing frames carry only metadata — conversation/response ids
// like "c_…" / "rc_…". So we keep the LONGEST text on the precise answer path and
// only deep-search as a last resort (skipping id-like strings). This is what
// stops a metadata frame from overwriting the answer (the "flash → c_…" bug).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.gemini = GA.gemini || {};

GA.gemini.parser = (function () {
  // --- StreamGenerate response shape ---
  // A decoded "wrb.fr" frame body is a positional array (Google's undocumented
  // RPC format). What each field holds:
  //   body[FIELD_CANDIDATES]                       -> [candidate, ...] answer candidates
  //   candidate[CANDIDATE_CONTENT]                 -> [answerText, ...] the reply content
  //   candidate[CANDIDATE_CONTENT][CONTENT_TEXT]   -> answerText (string)  <- what we want
  //   body[1]                                      -> [conversationId, responseId] (ids like "c_…")
  // If replies stop parsing, re-check these indices against a live request.
  const FIELD_CANDIDATES = 4;
  const CANDIDATE_CONTENT = 1;
  const CONTENT_TEXT = 0;

  const MAX_DEEP_DEPTH = 9; // guard against pathological nesting in the fallback
  const MIN_TEXT_LEN = 2; // shorter strings aren't answers
  const ID_HEX_MIN = 12; // a 12+ hex run is an opaque id, not prose
  const ID_NOSPACE_MIN = 20; // a 20+ char token with no spaces is an id/token

  function parseLatest(raw) {
    let best = null; // longest precise-path answer
    let fallback = null; // used only if no precise match exists anywhere
    const lines = String(raw == null ? "" : raw).split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.indexOf('[["wrb.fr"') !== 0) continue;
      let outer;
      try {
        outer = JSON.parse(t);
      } catch (e) {
        continue;
      }
      for (const item of outer) {
        if (!Array.isArray(item) || item[0] !== "wrb.fr" || !item[2]) continue;
        let body;
        try {
          body = JSON.parse(item[2]);
        } catch (e) {
          continue;
        }
        const precise = preciseText(body);
        if (precise != null) {
          if (best === null || precise.length > best.length) best = precise;
        } else if (fallback === null) {
          fallback = deepFindAnswer(body, 0);
        }
      }
    }
    return best !== null ? best : fallback;
  }

  // Pull the answer text from its known location in the response body.
  function preciseText(body) {
    try {
      const candidates = body[FIELD_CANDIDATES];
      const firstCandidate = candidates && candidates[0];
      const content = firstCandidate && firstCandidate[CANDIDATE_CONTENT];
      if (content && typeof content[CONTENT_TEXT] === "string") return content[CONTENT_TEXT];
    } catch (e) {}
    return null;
  }

  function deepFindAnswer(node, depth) {
    if (depth > MAX_DEEP_DEPTH) return null;
    if (typeof node === "string")
      return node.length > MIN_TEXT_LEN && !looksLikeId(node) ? node : null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const r = deepFindAnswer(c, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  // conversation/response/candidate ids and opaque tokens — never the answer
  function looksLikeId(s) {
    if (/^(c|r|rc|rcdb)_/i.test(s)) return true; // c_… r_… rc_… rcdb_…
    if (new RegExp("^[0-9a-f]{" + ID_HEX_MIN + ",}$", "i").test(s)) return true; // long hex token
    if (!/\s/.test(s) && s.length >= ID_NOSPACE_MIN) return true; // long unbroken token
    return false;
  }

  return { parseLatest, preciseText, deepFindAnswer, looksLikeId };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.gemini.parser;
