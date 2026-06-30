// thread-controller.js — owns the comment-thread lifecycle for the current
// conversation: create from a selection, restore on load, delete, re-anchor, and
// run the ask round-trip (compose prompt → get tokens → call the service Facade).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.threadController = (function () {
  const threadsById = new Map();
  let currentSession = null;

  function sessionKey() {
    return currentSession; // null -> store uses the draft bucket
  }

  function makeHandlers(thread) {
    return {
      ask: (t, opts) => askThread(t, opts),
      persist: (t) => GA.store.upsert(sessionKey(), t),
      onDelete: (t) => deleteThread(t),
      onFocus: (t) => GA.gutter.setActive(t.id),
      onExpand: (t) => GA.Modal.open(t),
      onResize: () => GA.gutter.scheduleLayout(),
    };
  }

  function addThread(thread) {
    const box = GA.ThreadBox(thread, makeHandlers(thread));
    threadsById.set(thread.id, thread);
    GA.gutter.add(thread.id, box);
    return box;
  }

  async function createFromSelection() {
    const cap = GA.selection.capture();
    if (!cap) {
      GA.toast("Select some text in an answer first.");
      return;
    }
    const thread = {
      id: GA.uid("t"),
      selector: cap.selector,
      section: GA.truncate(cap.sectionText, GA.config.SECTION_CHARS),
      messages: [],
      createdAt: Date.now(),
    };
    GA.selection.highlightRange(cap.range, thread.id);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    const box = addThread(thread);
    await GA.store.upsert(sessionKey(), thread);
    GA.gutter.relayout();
    GA.gutter.setActive(thread.id);
    box.focusInput();
  }

  function restoreThread(thread) {
    GA.selection.highlightSelector(thread.selector, thread.id); // empty -> orphan
    addThread(thread);
  }

  function deleteThread(thread) {
    GA.selection.unhighlight(thread.id);
    GA.gutter.remove(thread.id);
    threadsById.delete(thread.id);
    GA.store.remove(sessionKey(), thread.id);
  }

  function teardownAll() {
    GA.Modal.close();
    threadsById.forEach((t) => GA.selection.unhighlight(t.id));
    GA.gutter.clear();
    threadsById.clear();
  }

  async function restoreForSession(session) {
    currentSession = session;
    await GA.store.migrateDraft(session);
    (await GA.store.load(session)).forEach(restoreThread);
    GA.gutter.relayout();
    // Gemini hydrates async (and lazily) — retry anchoring for a while.
    GA.config.REANCHOR_RETRY_MS.forEach((d) => setTimeout(reanchorOrphans, d));
  }

  async function onRouteChange() {
    const next = GA.getSessionId();
    if (next === currentSession) return;
    teardownAll();
    await restoreForSession(next);
  }

  function reanchorOrphans() {
    threadsById.forEach((thread) => {
      if (!GA.selection.anchorEl(thread.id)) GA.selection.highlightSelector(thread.selector, thread.id);
    });
    GA.gutter.scheduleLayout();
  }

  function hasOrphans() {
    for (const t of threadsById.values()) {
      if (!GA.selection.anchorEl(t.id)) return true;
    }
    return false;
  }

  // ---- ask round-trip ----

  function composePrompt(thread) {
    const scope = GA.settings.scope;
    const deps = scope === "conversation" ? { conversationText: conversationText() } : {};
    return GA.core.prompt.composePrompt(thread, scope, deps);
  }

  function conversationText() {
    const parts = [];
    GA.selection.findAllSections().forEach((s) => {
      const t = (s.innerText || s.textContent || "").trim();
      if (t) parts.push(t);
    });
    return GA.truncate(parts.join("\n\n"), GA.config.CONVERSATION_CHARS);
  }

  async function askThread(thread, opts) {
    // Only Gemini needs page-scraped session tokens; ChatGPT/Claude acquire their
    // own auth in the background client.
    const tokens = GA.provider === "gemini" ? await GA.tokenProvider.get() : undefined;
    return GA.askService.ask(
      { provider: GA.provider, prompt: composePrompt(thread), tokens },
      opts && opts.onChunk
    );
  }

  return {
    createFromSelection,
    restoreForSession,
    onRouteChange,
    reanchorOrphans,
    hasOrphans,
  };
})();
