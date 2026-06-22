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
      const msg = "⚠️ " + (err && err.message ? err.message : "Request failed.");
      ops.renderModel(handle, msg);
      thread.messages.push({ role: "model", text: msg, ts: Date.now(), error: true });
      acc = msg;
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

  return { run };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.threadTurn;
