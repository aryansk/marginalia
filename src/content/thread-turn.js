// thread-turn.js — the presenter for one Q&A turn, lifted out of the view.
// All side effects are injected via `ops`, so the orchestration (append the
// question, persist, stream the reply, handle errors) is simple to follow and
// can be tested with fakes — no DOM required.
//
// ops = {
//   appendUser(text),                 // render the user's message
//   beginModel() -> handle,           // start an (empty) model message, return a handle
//   renderModel(handle, text),        // (re)render the model message
//   endModel(handle),                 // optional: finalize the model message
//   renderError(handle, message),     // optional: render a failure (retry card);
//                                     //   falls back to renderModel("⚠️ " + message)
//   setLoading(bool),
//   ask(thread, { onChunk }) -> Promise<string>,
//   persist(thread),
// }
var GA = (typeof GA !== "undefined" && GA) || {};

GA.threadTurn = (function () {
  async function run(thread, question, ops) {
    ops.appendUser(question);
    thread.messages.push({ role: "user", text: question, ts: Date.now() });
    await settle(ops.persist, thread);
    return askAndStream(thread, ops);
  }

  // Re-send the thread's last question after a failure: drop the trailing
  // error message and ask again — the question itself is still in
  // thread.messages, so the user never has to retype it.
  async function retry(thread, ops) {
    const last = thread.messages[thread.messages.length - 1];
    if (last && last.error) thread.messages.pop();
    await settle(ops.persist, thread);
    return askAndStream(thread, ops);
  }

  async function askAndStream(thread, ops) {
    ops.setLoading(true);
    const handle = ops.beginModel();
    let acc = "";
    try {
      const finalText = await ops.ask(thread, {
        onChunk(t) {
          acc = t;
          ops.renderModel(handle, acc);
        },
      });
      acc = finalText || acc;
      ops.renderModel(handle, acc);
      thread.messages.push({ role: "model", text: acc, ts: Date.now() });
    } catch (err) {
      if (err && err.name === "AbortError") {
        // Cancelled (stop button, conversation switch, thread deleted): keep
        // whatever streamed in as a normal message; no error card.
        if (acc) thread.messages.push({ role: "model", text: acc, ts: Date.now(), stopped: true });
      } else {
        const msg = (err && err.message) || "Request failed.";
        if (ops.renderError) ops.renderError(handle, msg);
        else ops.renderModel(handle, "⚠️ " + msg);
        thread.messages.push({ role: "model", text: msg, ts: Date.now(), error: true });
        acc = msg;
      }
    } finally {
      if (ops.endModel) ops.endModel(handle);
      ops.setLoading(false);
      await settle(ops.persist, thread);
    }
    return acc;
  }

  // Never let a persist failure reject the turn.
  function settle(fn, arg) {
    try {
      return Promise.resolve(fn && fn(arg));
    } catch (e) {
      return Promise.resolve();
    }
  }

  return { run, retry };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.threadTurn;
