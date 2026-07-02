// prompt.js — pure: compose the single prompt sent to Gemini for a follow-up.
// The amount of surrounding context is chosen by a Strategy keyed on `scope`.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.prompt = (function () {
  // Context-scope Strategy: each returns the context string for a thread.
  // `deps.conversationText` is supplied by the caller only for 'conversation'.
  const SCOPE = {
    selection: (thread) => thread.selector.exact,
    section: (thread) => thread.section || thread.selector.exact,
    conversation: (thread, deps) =>
      (deps && deps.conversationText) || thread.section || thread.selector.exact,
  };

  function composePrompt(thread, scope, deps) {
    const pick = SCOPE[scope] || SCOPE.section;
    const context = pick(thread, deps);
    const lines = [];
    lines.push("I'm reading an answer you (Gemini) gave me. Relevant context:");
    lines.push('"""');
    lines.push(context);
    lines.push('"""');
    lines.push("");
    lines.push('I highlighted this specific part: "' + thread.selector.exact + '"');
    lines.push("");
    lines.push("Our follow-up discussion so far:");
    (thread.messages || [])
      .filter((m) => !m.error) // failed-request notices aren't part of the conversation
      .forEach((m) => {
        lines.push((m.role === "user" ? "Me: " : "You: ") + m.text);
      });
    lines.push("");
    lines.push(
      "Answer my latest question concisely, focused only on the highlighted part. " +
        "Don't repeat the whole original explanation."
    );
    return lines.join("\n");
  }

  return { composePrompt, SCOPE };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.prompt;
