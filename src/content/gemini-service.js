// gemini-service.js — Facade over the background "ask" port. Callers get a
// simple `ask({prompt, tokens}, onChunk) -> Promise<string>` and never see the
// runtime port or the message protocol.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.geminiService = (function () {
  const P = GA.protocol;

  function ask(request, onChunk) {
    return new Promise(function (resolve, reject) {
      const port = browser.runtime.connect({ name: P.PORT_ASK });
      let finalText = "";
      let settled = false;
      port.onMessage.addListener(function (msg) {
        if (!msg) return;
        if (msg.type === P.MSG_CHUNK) {
          finalText = msg.text;
          if (onChunk) onChunk(msg.text);
        } else if (msg.type === P.MSG_DONE) {
          settled = true;
          resolve(msg.text || finalText);
          port.disconnect();
        } else if (msg.type === P.MSG_ERROR) {
          settled = true;
          reject(new Error(msg.message || "Request failed"));
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(function () {
        if (!settled) reject(new Error("Connection to extension closed."));
      });
      port.postMessage({ type: P.MSG_ASK, prompt: request.prompt, tokens: request.tokens });
    });
  }

  return { ask };
})();
