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

  // In-flight answer feeds by thread id (core/live-stream.js): askThread pushes
  // every chunk so a surface opened mid-stream (the modal) can late-join.
  const liveStreams = GA.core.liveStream.makeRegistry();

  function persistThread(thread) {
    if (!bindings.has(thread.id)) return Promise.resolve(); // deleted mid-flight
    return GA.store.upsert(bindings.sessionFor(thread.id), thread);
  }

  function makeHandlers() {
    return {
      ask: (t, opts) => askThread(t, opts),
      persist: (t) => persistThread(t),
      onDelete: (t) => deleteThread(t),
      onFocus: (t) => GA.gutter.focusThread(t.id),
      onExpand: (t) => expandThread(t),
      onStop: (t) => stopAsk(t.id),
      onLabel: (t, labels) => applyLabelCommand(t, labels),
      onResize: (opts) => GA.gutter.scheduleLayout(opts),
      liveStream: (id) => liveStreams.get(id),
      // Rail mode = narrow viewport, every box a chip; the box asks instead of
      // sniffing the gutter's DOM classes from inside.
      inRail: () => GA.gutter.mode() === "rail",
    };
  }

  function addThread(thread) {
    const box = GA.ThreadBox(thread, makeHandlers());
    threadsById.set(thread.id, thread);
    bindings.bind(thread.id, currentSession);
    GA.gutter.add(thread.id, box);
    return box;
  }

  // Standalone label records (kind:"label") share the thread lifecycle —
  // same bucket, same bindings, same gutter — but mount a LabelChip surface.
  function addLabel(record) {
    const chip = GA.LabelChip(record, makeHandlers());
    threadsById.set(record.id, record);
    bindings.bind(record.id, currentSession);
    GA.gutter.add(record.id, chip);
    return chip;
  }

  // /label policy (core/labels parses, this decides): a thread with history
  // gets the labels appended; an EMPTY thread is the label gesture itself —
  // the record converts to a standalone label on the same highlight, keeping
  // its id (so the session pin and the stored copy stay one record).
  function applyLabelCommand(thread, labels) {
    thread.labels = GA.core.labels.merge(thread.labels, labels);
    const empty = !(thread.messages || []).length;
    if (thread.kind !== "label" && empty) {
      thread.kind = "label";
      // Old surface out before the new one in — never two gutter entries.
      GA.gutter.remove(thread.id);
      addLabel(thread);
      GA.selection.setHighlightKind(thread.id, "label");
      GA.gutter.relayout();
      // The destroyed box had focus/active; hand both to the chip (same move
      // createFromSelection makes for a new box).
      GA.gutter.focusThread(thread.id);
      // The comment box just vanished into a chip — say what happened, or the
      // conversion reads as the thread being eaten.
      GA.toast("Labeled: " + thread.labels.join(", ") + " — this highlight is now a tag.");
    }
    return persistThread(thread);
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
    // Transcript capture runs NOW, not debounced: the turn this thread
    // annotates must survive even if the tab closes seconds later. (A
    // mid-stream partial captured here is cleaned up at render time by the
    // transcript builder's prefix-dedupe.)
    if (GA.convoCapture) GA.convoCapture.capture().catch((e) => GA.warn("convo capture failed", e));
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
    if (thread.kind === "label") addLabel(thread);
    else addThread(thread);
  }

  function deleteThread(thread) {
    // Abort any in-flight ask first: its finally-persist would otherwise
    // resurrect the thread in storage.
    bindings.handlesFor(thread.id).forEach((h) => {
      try {
        h.abort();
      } catch (e) {
        /* a torn-down handle may already be closed — nothing to do */
      }
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
    // Each restore is isolated: one malformed/legacy record must not abort the
    // loop and hide every other annotation. The failing record is skipped but
    // left INTACT in storage (never deleted or re-persisted here) so a future
    // load or migration can still deal with it.
    for (const thread of await GA.store.load(session)) {
      try {
        restoreThread(thread);
      } catch (e) {
        GA.warn("restore failed, skipping thread", thread && thread.id, e);
      }
    }
    GA.gutter.relayout();
    // Gemini hydrates async (and lazily) — retry anchoring for a while.
    GA.config.REANCHOR_RETRY_MS.forEach((d) => setTimeout(reanchorOrphans, d));
    // Revisit capture, debounced: turns are still hydrating here, and an empty
    // snapshot is a no-op — the settle pings that follow will catch the rest.
    if (GA.convoCapture) GA.convoCapture.schedule();
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
      } catch (e) {
        /* a drained handle may already be closed — nothing to do */
      }
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
    // Address the model by the active site's display name ("Gemini", "ChatGPT",
    // "Claude") so the persona line matches the provider being asked.
    const label = GA.core.sites.providerLabel(GA.provider);
    return GA.core.prompt.composePrompt(thread, scope, deps, label);
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
    // Feed the live registry alongside the caller's renderer, so the modal can
    // late-join this stream (see makeHandlers.liveStream). Token acquisition
    // and the expired-page-token retry live in GA.askFlow (shared with the
    // panel's synthesis flow); the flow handle spans both attempts, so one
    // track/untrack pair covers the retry too.
    const feed = liveStreams.begin(thread.id);
    const onChunk = (t) => {
      feed.push(t);
      if (opts && opts.onChunk) opts.onChunk(t);
    };
    const handle = GA.askFlow.ask(composePrompt(thread), onChunk);
    bindings.trackAsk(thread.id, handle);
    try {
      return await handle.result;
    } finally {
      bindings.untrackAsk(thread.id, handle);
      liveStreams.end(thread.id);
    }
  }

  // Stop button hook: end the thread's in-flight ask, keeping the partial text.
  function stopAsk(threadId) {
    bindings.handlesFor(threadId).forEach((h) => {
      try {
        h.stop();
      } catch (e) {
        /* the ask may have settled and closed its handle already — nothing to do */
      }
    });
  }

  // Maximize a thread into the modal (with a live composer). While it is open
  // the docked box minimizes to its chip (transient — never persisted) so the
  // modal is the single live view; closing restores the prior state and
  // re-renders whatever the modal conversation added.
  function expandThread(thread) {
    const it = GA.gutter.get(thread.id);
    const wasCompact = !!(it && it.box.isCompact());
    if (it && !wasCompact) it.box.setCollapsed(true, { persist: false });
    // The in-progress draft follows the user into the modal and, if still
    // unsent when the modal closes, comes back to the docked box.
    const draft = it && it.box.takeDraft ? it.box.takeDraft() : "";
    // A standalone label has no conversation to continue — open read-only
    // (no composer) rather than let a modal question graft messages onto it.
    GA.Modal.open(
      thread,
      thread.kind === "label" ? null : makeHandlers(),
      function (modalDraft) {
        const cur = GA.gutter.get(thread.id);
        if (cur) {
          if (!wasCompact) cur.box.setCollapsed(false, { persist: false });
          if (cur.box.refreshMessages) cur.box.refreshMessages();
          if (modalDraft && cur.box.setDraft) cur.box.setDraft(modalDraft);
        }
        GA.gutter.scheduleLayout();
      },
      { draft },
    );
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
