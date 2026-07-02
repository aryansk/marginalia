// api-util.js — shared transport helpers for the official-API clients (OpenAI,
// Google AI, Anthropic) and the reverse-engineered web clients: the SSE streaming
// loop, a per-request abort budget, and error formatting. They all behave the
// same way, so this lives here rather than being copied into each client.
var GA = (typeof GA !== "undefined" && GA) || {};

// Default idle timeout for a single ask (ms). A slow-but-live stream is fine;
// this only kills a connection that goes silent for this long.
GA.REQUEST_TIMEOUT_MS = 60000;

// An abort "budget" for one request: it aborts if `ms` elapses without a
// `bump()`. Callers pass `signal` to fetch and `bump()` as bytes arrive, so a
// stalled connection is cancelled while a live (slow) stream keeps going. Call
// `clear()` when done so the timer can't fire late. `aborted()` distinguishes a
// timeout from other fetch failures.
GA.makeAbortBudget = function (ms) {
  const controller = new AbortController();
  const limit = ms || GA.REQUEST_TIMEOUT_MS;
  let timer = null;
  function fire() {
    try {
      controller.abort();
    } catch (e) {}
  }
  function arm() {
    timer = setTimeout(fire, limit);
  }
  function bump() {
    if (timer) clearTimeout(timer);
    arm();
  }
  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  arm();
  return {
    signal: controller.signal,
    bump: bump,
    clear: clear,
    aborted: function () {
      return controller.signal.aborted;
    },
  };
};

// Read an SSE response, re-parsing the growing buffer and emitting each newly
// longer answer (same shape as gemini/client.js). `parseLatest(buffer)` returns
// the full answer so far, or null. Pass an optional abort `budget` to reset its
// idle timer as chunks arrive.
GA.streamSSE = async function (res, parseLatest, onChunk, name, budget) {
  const failMsg = "Couldn't parse " + name + "'s response — the API shape may have changed.";
  if (!res.body || !res.body.getReader) {
    const text = parseLatest(await res.text());
    if (text == null) throw new Error(failMsg);
    if (onChunk) onChunk(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (budget) budget.bump();
    buf += decoder.decode(value, { stream: true });
    const text = parseLatest(buf);
    if (text != null && text !== last) {
      last = text;
      if (onChunk) onChunk(text);
    }
  }
  const finalText = parseLatest(buf) || last;
  if (!finalText) throw new Error(failMsg);
  return finalText;
};

// Build a helpful message from a failed API response. Prefer the API's
// error.message; fall back to the raw body when it isn't JSON (instead of a bare
// "HTTP 500"), so failures stay diagnosable.
GA.apiError = async function (name, res) {
  let detail = "";
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = (j && j.error && (j.error.message || j.error)) || (j && j.message) || "";
    } catch (e) {
      detail = body; // non-JSON body — surface it raw
    }
  } catch (e) {}
  detail = detail ? String(detail).trim() : "";
  return name + " API error (HTTP " + res.status + ")" + (detail ? ": " + detail.slice(0, 200) : ".");
};
