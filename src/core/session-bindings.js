// session-bindings.js — pure bookkeeping that pins every thread to the session
// (conversation) it was created or restored under, and tracks its in-flight ask
// handles. The controller persists through the PINNED session, never through
// "whatever conversation is open right now" — so an answer that finishes after
// the user switched conversations still lands in the right storage bucket.
//
// No DOM, no storage, no timers: just a state machine, unit-tested in
// tests/core/session-bindings.test.js. `session` is a string or null (null =
// the pre-id draft bucket).
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.sessionBindings = (function () {
  function create() {
    const sessions = new Map(); // threadId -> session (string | null)
    const asks = new Map(); // threadId -> Set<handle>

    return {
      bind(threadId, session) {
        sessions.set(threadId, session == null ? null : session);
      },

      has(threadId) {
        return sessions.has(threadId);
      },

      // The pinned session, or undefined when the thread was never bound /
      // already unbound (deleted) — callers drop the write in that case.
      sessionFor(threadId) {
        return sessions.get(threadId);
      },

      // Draft birth: the chat just got a real id. Move only DRAFT-bound
      // threads (session === null) to it; threads pinned to earlier real
      // sessions must keep their pin. Returns the rebound thread ids.
      rebindDrafts(session) {
        const moved = [];
        if (session == null) return moved;
        sessions.forEach(function (s, id) {
          if (s === null) {
            sessions.set(id, session);
            moved.push(id);
          }
        });
        return moved;
      },

      unbind(threadId) {
        sessions.delete(threadId);
        asks.delete(threadId);
      },

      trackAsk(threadId, handle) {
        if (!asks.has(threadId)) asks.set(threadId, new Set());
        asks.get(threadId).add(handle);
      },

      untrackAsk(threadId, handle) {
        const set = asks.get(threadId);
        if (!set) return;
        set.delete(handle);
        if (!set.size) asks.delete(threadId);
      },

      handlesFor(threadId) {
        const set = asks.get(threadId);
        return set ? Array.from(set) : [];
      },

      // All live handles (for route-change abort). Clears tracking; the
      // caller invokes each handle's abort().
      drainHandles() {
        const all = [];
        asks.forEach(function (set) {
          set.forEach(function (h) {
            all.push(h);
          });
        });
        asks.clear();
        return all;
      },
    };
  }

  return { create };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.sessionBindings;
