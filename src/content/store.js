// store.js — persistence in browser.storage.local, keyed strictly by session id.
// Threads from one conversation never bleed into another; the session id is
// already provider-qualified ("<provider>:<id>", see util.js), and the pre-id
// draft bucket is namespaced per provider AND per tab (GA.tabToken) so neither
// two sites nor two tabs of the same site can collide.
var GA = GA || {};

GA.store = (function () {
  const PREFIX = GA.schema.THREADS_PREFIX;
  const DRAFT = GA.schema.DRAFT_SESSION; // used before a brand-new chat has an id

  // Draft bucket for the current site + tab, e.g. "__draft__:chatgpt:tab_x1".
  function draftKey() {
    return DRAFT + ":" + (GA.provider || "x") + ":" + (GA.tabToken || "x");
  }

  function key(sessionId) {
    return PREFIX + (sessionId || draftKey());
  }

  // Every mutation is load-modify-save over the whole session array. Serialize
  // them through one promise chain so concurrent writers (a completing answer's
  // persist racing a delete, say) can't interleave and drop each other's change.
  let queue = Promise.resolve();
  function serialize(op) {
    const run = queue.then(op, op);
    queue = run.then(
      () => undefined,
      () => undefined // one failed op must not poison the chain
    );
    return run;
  }

  async function loadRaw(sessionId) {
    const k = key(sessionId);
    const obj = await browser.storage.local.get(k);
    return Array.isArray(obj[k]) ? obj[k] : [];
  }

  async function saveAllRaw(sessionId, threads) {
    await browser.storage.local.set({ [key(sessionId)]: threads });
  }

  function load(sessionId) {
    return serialize(() => loadRaw(sessionId)); // reads see all queued writes
  }

  function saveAll(sessionId, threads) {
    return serialize(() => saveAllRaw(sessionId, threads));
  }

  function upsert(sessionId, thread) {
    return serialize(async () => {
      const threads = await loadRaw(sessionId);
      const i = threads.findIndex((t) => t.id === thread.id);
      if (i >= 0) threads[i] = thread;
      else threads.push(thread);
      await saveAllRaw(sessionId, threads);
      return thread;
    });
  }

  function remove(sessionId, threadId) {
    return serialize(async () => {
      const threads = (await loadRaw(sessionId)).filter((t) => t.id !== threadId);
      await saveAllRaw(sessionId, threads);
    });
  }

  // Move threads created before the chat had an id (DRAFT bucket) into the real
  // session. De-dupes by thread id — a rebound in-flight persist may already
  // have written the same thread to the target.
  function migrateDraft(toSessionId) {
    if (!toSessionId) return Promise.resolve();
    return serialize(async () => {
      const drafts = await loadRaw(null); // this tab's DRAFT bucket
      if (!drafts.length) return;
      const target = await loadRaw(toSessionId);
      const known = new Set(target.map((t) => t.id));
      const fresh = drafts.filter((t) => !known.has(t.id));
      await saveAllRaw(toSessionId, target.concat(fresh));
      await browser.storage.local.remove(key(null));
    });
  }

  // A draft bucket is stale when its newest thread is older than the TTL (or it
  // holds nothing datable). Pure — exported for tests.
  function isStaleDraft(threads, now) {
    const ttl = (GA.config && GA.config.DRAFT_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
    let newest = 0;
    (threads || []).forEach((t) => {
      if (t && t.createdAt > newest) newest = t.createdAt;
    });
    return newest < now - ttl;
  }

  // Startup housekeeping for `ga:threads:__draft__:*`:
  //  - legacy per-provider buckets (pre tab-token, "__draft__:<provider>") for
  //    THIS provider are adopted into this tab's bucket (upgrade path);
  //  - abandoned buckets (closed tabs, older than DRAFT_TTL_MS) are removed;
  //  - other tabs'/providers' fresh buckets are left alone.
  function sweepDrafts(now) {
    return serialize(async () => {
      const ts = now || Date.now();
      const all = await browser.storage.local.get();
      const draftPrefix = PREFIX + DRAFT + ":";
      const toRemove = [];
      let adopted = null;
      for (const k of Object.keys(all)) {
        if (k.indexOf(draftPrefix) !== 0 || k === key(null)) continue;
        const rest = k.slice(draftPrefix.length); // "<provider>" | "<provider>:<tab>"
        const threads = Array.isArray(all[k]) ? all[k] : [];
        const legacyOwn = rest === (GA.provider || "x");
        if (legacyOwn && threads.length && !isStaleDraft(threads, ts)) {
          adopted = threads;
          toRemove.push(k);
        } else if (isStaleDraft(threads, ts)) {
          toRemove.push(k);
        }
      }
      if (adopted) {
        const mine = await loadRaw(null);
        const known = new Set(mine.map((t) => t.id));
        await saveAllRaw(null, mine.concat(adopted.filter((t) => !known.has(t.id))));
      }
      if (toRemove.length) await browser.storage.local.remove(toRemove);
    });
  }

  async function clearAll() {
    const all = await browser.storage.local.get();
    const toRemove = Object.keys(all).filter((k) => k.indexOf(PREFIX) === 0);
    if (toRemove.length) await browser.storage.local.remove(toRemove);
  }

  return { load, saveAll, upsert, remove, migrateDraft, sweepDrafts, isStaleDraft, clearAll };
})();
