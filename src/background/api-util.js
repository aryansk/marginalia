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
//
// `externalSignal` (optional) chains a caller-owned AbortSignal in — used by the
// background to cancel the whole ask when the content side disconnects.
// `cancelled()` tells an external abort apart from an idle timeout, so clients
// can throw AbortError ("user stopped this") instead of "timed out".
GA.makeAbortBudget = function (ms, externalSignal) {
  const controller = new AbortController();
  const limit = ms || GA.REQUEST_TIMEOUT_MS;
  let timer = null;
  let external = false;
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
  function onExternalAbort() {
    external = true;
    if (timer) clearTimeout(timer);
    timer = null;
    fire();
  }
  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  arm();
  return {
    signal: controller.signal,
    bump: bump,
    clear: clear,
    aborted: function () {
      return controller.signal.aborted;
    },
    cancelled: function () {
      return external;
    },
  };
};

// The error a client throws when its budget was cancelled from outside (port
// disconnect / user stop) — callers check err.name === "AbortError".
GA.abortError = function () {
  const e = new Error("Cancelled.");
  e.name = "AbortError";
  return e;
};

// Read a streamed response through an incremental parser cursor
// (`{ push(text) -> answerSoFar|null, end() -> answer|null }`, see
// sse.makeStream / gemini.parser.makeStream) and emit each newly different
// answer. One read-loop for every provider — official-API and web-session
// clients alike. Pass an optional abort `budget` to reset its idle timer as
// chunks arrive. `failMsg` is thrown when the response yields no answer at all.
GA.streamText = async function (res, stream, onChunk, failMsg, budget) {
  if (!res.body || !res.body.getReader) {
    stream.push(await res.text());
    const text = stream.end();
    if (text == null || text === "") throw new Error(failMsg);
    if (onChunk) onChunk(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let last = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (budget) budget.bump();
    const text = stream.push(decoder.decode(value, { stream: true }));
    if (text != null && text !== last) {
      last = text;
      if (onChunk) onChunk(text);
    }
  }
  const pending = decoder.decode(); // flush a trailing partial code point
  if (pending) stream.push(pending);
  const finalText = stream.end() || last;
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
