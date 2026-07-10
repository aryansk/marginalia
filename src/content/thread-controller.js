// thread-controller.js — owns the comment-thread lifecycle for the current
// conversation: create from a selection, restore on load, delete, re-anchor, and
// run the ask round-trip (compose prompt → get tokens → call the service Facade).
var GA = (typeof GA !== "undefined" && GA) || {};

GA.threadController = (function () {
  const threadsById = new Map();
  let currentSession = null;

  // Every thread is PINNED to the session it was created/restored under (see
  // core/session-bindings.js). Persist/delete always go through the pin, so an
  // answer that arrives after a conversation switch can't bleed into the new
  // conversation's bucket. Unbound (deleted) threads drop their writes.
  const bindings = GA.core.sessionBindings.create();

  function persistThread(thread) {
    if (!bindings.has(thread.id)) return Promise.resolve(); // deleted mid-flight
    return GA.store.upsert(bindings.sessionFor(thread.id), thread);
  }

  function makeHandlers(thread) {
    return {
      ask: (t, opts) => askThread(t, opts),
      persist: (t) => persistThread(t),
      onDelete: (t) => deleteThread(t),
      onFocus: (t) => GA.gutter.focusThread(t.id),
      onExpand: (t) => expandThread(t),
      onStop: (t) => stopAsk(t.id),
      onResize: (opts) => GA.gutter.scheduleLayout(opts),
    };
  }

  function addThread(thread) {
    const box = GA.ThreadBox(thread, makeHandlers(thread));
    threadsById.set(thread.id, thread);
    bindings.bind(thread.id, currentSession);
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
      // Who spoke and which message — so a reload re-anchors inside the answer
      // this was written on, not on an earlier question that repeats a word.
      anchor: cap.anchor,
      section: GA.truncate(cap.sectionText, GA.config.SECTION_CHARS),
      messages: [],
      createdAt: Date.now(),
    };
    GA.selection.highlightRange(cap.range, thread.id);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    const box = addThread(thread);
    await persistThread(thread);
    // Focus the newly-created thread: collapse the others to chips, then let the
    // single relayout below settle everyone. focusThread runs AFTER addThread
    // (box registered → excluded from the collapse sweep, marked active) and
    // BEFORE relayout() (others' isCompact already flipped → one settled reflow,
    // no flash of all-expanded, new box never self-collapsed).
    GA.gutter.focusThread(thread.id);
    GA.gutter.relayout();
    box.focusInput();
  }

  function restoreThread(thread) {
    const hadAnchor = !!thread.anchor;
    GA.selection.highlightThread(thread); // no spans -> orphan, retried later
    // A thread created before turn identity existed just learned its role and
    // message. Record it so the next reload takes the exact path.
    if (!hadAnchor && thread.anchor) persistThread(thread);
    addThread(thread);
  }

  function deleteThread(thread) {
    // Abort any in-flight ask first: its finally-persist would otherwise
    // resurrect the thread in storage.
    bindings.handlesFor(thread.id).forEach((h) => {
      try {
        h.abort();
      } catch (e) {}
    });
    GA.selection.unhighlight(thread.id);
    GA.gutter.remove(thread.id);
    threadsById.delete(thread.id);
    const session = bindings.sessionFor(thread.id);
    bindings.unbind(thread.id);
    GA.store.remove(session, thread.id);
  }

  function teardownAll() {
    GA.Modal.close();
    threadsById.forEach((t) => GA.selection.unhighlight(t.id));
    GA.gutter.clear();
    threadsById.clear();
    // Bindings are deliberately KEPT: an aborted turn's final persist still
    // needs its pin to land in the old conversation's bucket.
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

    // Draft birth: the first message just gave this chat a real id. Nothing
    // about the page's threads changed — keep boxes, highlights, and in-flight
    // asks alive; only repoint the draft pins and move the stored bucket.
    if (currentSession == null && next != null && threadsById.size > 0) {
      currentSession = next;
      bindings.rebindDrafts(next); // future persists land in the real bucket…
      await GA.store.migrateDraft(next); // …and stored draft copies move over (de-duped)
      return;
    }

    // Real conversation switch: cancel in-flight asks before tearing down
    // their boxes; their turns finalize via the AbortError path and persist
    // (partial text included) through their pinned session.
    bindings.drainHandles().forEach((h) => {
      try {
        h.abort();
      } catch (e) {}
    });
    teardownAll();
    await restoreForSession(next);
  }

  function reanchorOrphans() {
    // Collect every orphan first, then re-anchor them in ONE batch pass —
    // section text is extracted once per pass instead of once per thread.
    const orphans = [];
    threadsById.forEach((thread) => {
      if (!GA.selection.anchorEl(thread.id)) orphans.push(thread);
    });
    if (orphans.length) {
      // Drop stale spans (dead or hidden subtrees) before re-wrapping, so a
      // re-render can't leave duplicates behind.
      orphans.forEach((t) => GA.selection.unhighlight(t.id));
      GA.selection.reanchorAll(orphans);
    }
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
    const limit = GA.config.CONVERSATION_CHARS;
    const parts = [];
    let total = 0;
    for (const s of GA.selection.findAllSections()) {
      const t = (s.innerText || s.textContent || "").trim();
      if (!t) continue;
      parts.push(t);
      total += t.length + 2;
      if (total >= limit) break; // truncate() drops the rest anyway — stop reading
    }
    return GA.truncate(parts.join("\n\n"), limit);
  }

  async function askThread(thread, opts) {
    // Page-scraped session tokens are only needed for the Gemini *web* path —
    // skip them when a Gemini API key is set (the background uses the official API)
    // or on ChatGPT/Claude (their clients acquire their own auth).
    const needsGeminiWebTokens = GA.provider === "gemini" && !GA.settings.geminiApiKey;
    const prompt = composePrompt(thread);

    async function once() {
      const tokens = needsGeminiWebTokens ? await GA.tokenProvider.get() : undefined;
      const handle = GA.askService.ask(
        { provider: GA.provider, prompt, tokens },
        opts && opts.onChunk
      );
      bindings.trackAsk(thread.id, handle);
      try {
        return await handle.result;
      } finally {
        bindings.untrackAsk(thread.id, handle);
      }
    }

    try {
      return await once();
    } catch (e) {
      // Expired Gemini page token: drop the cached one, re-scrape, retry once.
      if (needsGeminiWebTokens && e && e.code === "AUTH") {
        GA.tokenProvider.invalidate();
        return once();
      }
      throw e;
    }
  }

  // Stop button hook: end the thread's in-flight ask, keeping the partial text.
  function stopAsk(threadId) {
    bindings.handlesFor(threadId).forEach((h) => {
      try {
        h.stop();
      } catch (e) {}
    });
  }

  // Maximize a thread into the modal (with a live composer). When it closes,
  // the docked box re-renders whatever the modal conversation added.
  function expandThread(thread) {
    GA.Modal.open(thread, makeHandlers(thread), function () {
      const it = GA.gutter.get(thread.id);
      if (it && it.box.refreshMessages) it.box.refreshMessages();
      GA.gutter.scheduleLayout();
    });
  }

  function expandThreadById(threadId) {
    const t = threadsById.get(threadId);
    if (t) expandThread(t);
  }

  return {
    createFromSelection,
    restoreForSession,
    onRouteChange,
    reanchorOrphans,
    hasOrphans,
    stopAsk,
    expandThreadById,
    threads: () => Array.from(threadsById.values()),
  };
})();
