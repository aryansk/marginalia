// store.js — persistence in browser.storage.local, keyed strictly by session id.
// Threads from one conversation never bleed into another; the session id is
// already provider-qualified ("<provider>:<id>", see util.js), and the pre-id
// draft bucket is namespaced per provider AND per tab (GA.tabToken) so neither
// two sites nor two tabs of the same site can collide.
//
// Draft lifecycle is promote-or-RETAIN: drafts are promoted to the real
// conversation bucket once an id appears (migrateDraft), and any that never
// promote are adopted back into the current tab's bucket on startup
// (sweepDrafts). No code path here deletes a draft bucket that still holds
// threads — only empty buckets are ever removed.
var GA = (typeof GA !== "undefined" && GA) || {};

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
      () => undefined, // one failed op must not poison the chain
    );
    return run;
  }

  async function loadRaw(sessionId) {
    const k = key(sessionId);
    const obj = await browser.storage.local.get(k);
    // Drop null/undefined slots defensively: one poisoned element would wedge
    // every future `.map((t) => t.id)` over the bucket, permanently blocking
    // promotion and adoption.
    return Array.isArray(obj[k]) ? obj[k].filter(Boolean) : [];
  }

  // THE one createdAt stamp site: every thread persisted through the store
  // carries a numeric createdAt (threads without one are otherwise undatable,
  // which the draft housekeeping must then conservatively keep forever).
  // Stamps in place so the caller's object matches what storage holds.
  // NOTE on versioning: a ga:threads:* bucket is intentionally an UNVERSIONED
  // bare array (unlike ga:convo:* records, which carry a `v` stamp). Changing
  // the stored shape here would be a migration; any future versioned shape
  // must be detected by sniffing (Array = legacy v1, envelope object = newer).
  async function saveAllRaw(sessionId, threads) {
    threads = (threads || []).filter(Boolean); // never persist null slots
    threads.forEach((t) => {
      if (typeof t.createdAt !== "number") t.createdAt = Date.now();
    });
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
  // The draft bucket can be SHARED with another browsing context (the
  // "tab_shared" sessionStorage fallback, or a duplicated tab, which copies
  // sessionStorage and with it the tab token), so it is re-read after the
  // target save and only the threads we actually migrated are dropped — a
  // blind remove would delete a draft the other context wrote mid-migration.
  function migrateDraft(toSessionId) {
    if (!toSessionId) return Promise.resolve();
    return serialize(async () => {
      const drafts = await loadRaw(null); // this tab's DRAFT bucket
      if (!drafts.length) return;
      const target = await loadRaw(toSessionId);
      const known = new Set(target.map((t) => t.id).filter((id) => id != null));
      const fresh = drafts.filter((t) => t.id == null || !known.has(t.id));
      await saveAllRaw(toSessionId, target.concat(fresh)); // target saved FIRST
      const migrated = new Set(drafts.map((t) => t.id).filter((id) => id != null));
      const leftover = (await loadRaw(null)).filter((t) => t.id != null && !migrated.has(t.id));
      if (leftover.length) await saveAllRaw(null, leftover);
      else await browser.storage.local.remove(key(null));
    });
  }

  // Startup housekeeping for `ga:threads:__draft__:*` — retain, never reap.
  // A draft bucket that still holds threads is NEVER deleted for being old;
  // non-promotion must degrade to "threads pile up in this tab's bucket", not
  // to silent data loss. Concretely, for THIS provider's buckets:
  //  - every NON-EMPTY bucket that isn't this tab's own (legacy pre-tab-token
  //    keys, closed/other tabs' keys — any tabToken, any age) is ADOPTED into
  //    this tab's bucket, union by thread id; the target is saved BEFORE the
  //    source keys are removed (copy-then-remove, like migrateDraft) so a
  //    crash mid-sweep can never strand threads;
  //  - EMPTY buckets are removed — emptiness is the only removal criterion;
  //  - a bucket holding something that isn't an array is left untouched
  //    (unrecognized shape ≠ empty).
  // Removal is verify-then-remove: storage.local has no transactions and
  // another same-provider tab may be sweeping (and adopting into a key we
  // scanned) or drafting concurrently, so each source key is re-read right
  // before removal and deleted only if its contents are still exactly the
  // snapshot we adopted. A key that changed is left for the next sweep; the
  // remaining race window is a few microtasks instead of the whole sweep.
  // Other providers' buckets are left alone. Age plays no part in sweeping.
  function sweepDrafts() {
    return serialize(async () => {
      const draftPrefix = PREFIX + DRAFT + ":";
      // Key-filtered read (same pattern as listThreadBuckets): the sweep only
      // needs the tiny draft buckets — an unfiltered get() would drag every
      // multi-MB ga:convo:* blob across the storage IPC on every page load.
      let all;
      if (typeof browser.storage.local.getKeys === "function") {
        const draftKeys = (await browser.storage.local.getKeys()).filter(
          (k) => k.indexOf(draftPrefix) === 0,
        );
        all = draftKeys.length ? await browser.storage.local.get(draftKeys) : {};
      } else {
        all = await browser.storage.local.get();
      }
      const prov = GA.provider || "x";
      const sources = []; // [key, scan-time snapshot JSON]
      const adopted = [];
      for (const k of Object.keys(all)) {
        if (k.indexOf(draftPrefix) !== 0 || k === key(null)) continue;
        const rest = k.slice(draftPrefix.length); // "<provider>" | "<provider>:<tab>"
        if (rest !== prov && rest.indexOf(prov + ":") !== 0) continue; // other provider
        if (!Array.isArray(all[k])) continue; // unrecognized shape — never classify as empty
        sources.push([k, JSON.stringify(all[k])]);
        adopted.push(...all[k].filter(Boolean));
      }
      if (adopted.length) {
        const mine = await loadRaw(null);
        const known = new Set(mine.map((t) => t.id).filter((id) => id != null));
        const fresh = adopted.filter((t) => {
          if (t.id == null) return true; // id-less threads never de-dupe each other away
          if (known.has(t.id)) return false;
          known.add(t.id); // de-dupe across source buckets too
          return true;
        });
        if (fresh.length) await saveAllRaw(null, mine.concat(fresh));
      }
      const toRemove = [];
      for (const [k, snap] of sources) {
        const cur = (await browser.storage.local.get(k))[k];
        if (cur !== undefined && JSON.stringify(cur) === snap) toRemove.push(k);
      }
      if (toRemove.length) await browser.storage.local.remove(toRemove);
    });
  }

  // listThreadBuckets() -> [{ session, threads }] for every REAL conversation
  // bucket (drafts excluded — they belong to a tab, not a conversation).
  // Serialized, so the listing sees every queued persist. Prefers
  // storage.local.getKeys() (Chrome ≥130 / recent Firefox) plus a scoped get so
  // the multi-MB compressed ga:convo:* blobs never cross the storage IPC; the
  // get() (everything) fallback is filtered immediately and nothing else is
  // retained. Nothing here ever decodes a convo blob.
  function listThreadBuckets() {
    return serialize(async () => {
      const draftPrefix = PREFIX + DRAFT + ":";
      const isBucketKey = (k) => k.indexOf(PREFIX) === 0 && k.indexOf(draftPrefix) !== 0;
      let all;
      if (typeof browser.storage.local.getKeys === "function") {
        const keys = (await browser.storage.local.getKeys()).filter(isBucketKey);
        all = keys.length ? await browser.storage.local.get(keys) : {};
      } else {
        all = await browser.storage.local.get();
      }
      const out = [];
      for (const k of Object.keys(all)) {
        if (!isBucketKey(k) || !Array.isArray(all[k])) continue;
        out.push({ session: k.slice(PREFIX.length), threads: all[k].filter(Boolean) });
      }
      return out;
    });
  }

  async function clearAll() {
    let keys;
    if (typeof browser.storage.local.getKeys === "function") {
      keys = await browser.storage.local.getKeys();
    } else {
      keys = Object.keys(await browser.storage.local.get());
    }
    const toRemove = keys.filter((k) => k.indexOf(PREFIX) === 0);
    if (toRemove.length) await browser.storage.local.remove(toRemove);
  }

  // ---- conversation transcripts (ga:convo:*) -------------------------------
  // One record per session: { v, provider, id, title, url, capturedAt,
  //   turns:[{role, fp:{hash,len}, order}], blobs:{ "<hash>:<len>": <gzip+b64> } }.
  // `v` is the record schema version (currently 1), stamped by the writer
  // (convo-capture.js). Records written before the stamp existed lack it —
  // readers MUST treat a missing `v` as v1.
  // The store carries records verbatim: blobs are opaque already-compressed
  // strings here — loadConvo NEVER decompresses and saveConvo NEVER compresses
  // (GA.core.compress owns the codec; the sole decompress site is
  // convo-repair.js's loadDecoded).
  // Blob keys use BOTH fingerprint parts (fp.hash + ":" + fp.len) so a hash
  // collision can't render the wrong text under a turn.
  const CONVO = GA.schema.CONVO_PREFIX;

  function convoKey(session) {
    return CONVO + session;
  }

  // loadConvo(session) -> the RAW stored record, or null (unknown/falsy session).
  function loadConvo(session) {
    if (!session) return Promise.resolve(null); // drafts never get a convo bucket
    return serialize(async () => {
      const k = convoKey(session);
      const obj = await browser.storage.local.get(k);
      return obj[k] === undefined ? null : obj[k];
    });
  }

  // saveConvo(session, record) -> Promise<void>. Plain JSON write through the
  // same serialize() queue as every other store mutation. Falsy session: no-op.
  function saveConvo(session, record) {
    if (!session) return Promise.resolve();
    return serialize(async () => {
      await browser.storage.local.set({ [convoKey(session)]: record });
    });
  }

  // mergeTurns — THIN delegate to the system's ONE order-preserving turn-index
  // merge (see backup.js). Deliberately not reimplemented or wrapped: callers
  // get mergeTurnLists's exact contract (pure, idempotent, multiset-safe).
  function mergeTurns(existingTurns, newTurns) {
    return GA.core.backup.mergeTurnLists(existingTurns, newTurns);
  }

  return {
    load,
    saveAll,
    upsert,
    remove,
    migrateDraft,
    sweepDrafts,
    listThreadBuckets,
    clearAll,
    convoKey,
    loadConvo,
    saveConvo,
    mergeTurns,
  };
})();
