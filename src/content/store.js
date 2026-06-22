// store.js — persistence in browser.storage.local, keyed strictly by session id.
// Threads from one Gemini conversation (/app/<id>) never bleed into another.
var GA = GA || {};

GA.store = (function () {
  const PREFIX = GA.schema.THREADS_PREFIX;
  const DRAFT = GA.schema.DRAFT_SESSION; // used before a brand-new chat has an /app/<id>

  function key(sessionId) {
    return PREFIX + (sessionId || DRAFT);
  }

  async function load(sessionId) {
    const k = key(sessionId);
    const obj = await browser.storage.local.get(k);
    return Array.isArray(obj[k]) ? obj[k] : [];
  }

  async function saveAll(sessionId, threads) {
    await browser.storage.local.set({ [key(sessionId)]: threads });
  }

  async function upsert(sessionId, thread) {
    const threads = await load(sessionId);
    const i = threads.findIndex((t) => t.id === thread.id);
    if (i >= 0) threads[i] = thread;
    else threads.push(thread);
    await saveAll(sessionId, threads);
    return thread;
  }

  async function remove(sessionId, threadId) {
    const threads = (await load(sessionId)).filter((t) => t.id !== threadId);
    await saveAll(sessionId, threads);
  }

  // Move threads created before the chat had an id (DRAFT bucket) into the real session.
  async function migrateDraft(toSessionId) {
    if (!toSessionId) return;
    const drafts = await load(null); // DRAFT bucket
    if (!drafts.length) return;
    const target = await load(toSessionId);
    await saveAll(toSessionId, target.concat(drafts));
    await browser.storage.local.remove(key(null));
  }

  async function clearAll() {
    const all = await browser.storage.local.get();
    const toRemove = Object.keys(all).filter((k) => k.indexOf(PREFIX) === 0);
    if (toRemove.length) await browser.storage.local.remove(toRemove);
  }

  return { load, saveAll, upsert, remove, migrateDraft, clearAll };
})();
