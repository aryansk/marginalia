// convo-capture.js — populates the ga:convo:* transcript store from the live
// page, for ANNOTATED conversations only. Gemini virtualizes the message list,
// so no single look at the DOM sees the whole conversation; each capture merges
// what is currently mounted into the stored record, and the transcript
// accumulates across visits and scrolls (in BOTH directions — the merge is the
// order-preserving interleave in backup.js, via GA.store.mergeTurns).
//
// Compression is per-message and ONLY-NEW: a turn whose blob key
// (fp.hash + ":" + fp.len — both fingerprint parts, always) already exists in
// the record is never re-compressed, and nothing here ever DECOMPRESSES — the
// capture path reads only the plaintext index and the blob keys. The sole
// decompress site is convo-repair.js's loadDecoded.
//
// Turn discovery is pure reuse of GA.turns (findTurns/textOf) — this module
// does no scraping of its own. Fingerprints are computed from the exact text
// being captured (same fingerprint function turns.js uses) rather than read
// from turns.js's element cache: that cache is invalidated asynchronously, and
// a blob key must never disagree with the text stored under it.
//
// The merge POLICY (keys, shape guard, stale-partial upgrade, and the
// provability rules that license a merge) lives in core/convo-merge.js — this
// module only wires it to the live page and the store.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.convoCapture = (function () {
  function debounceMs() {
    return (GA.config && GA.config.CONVO_CAPTURE_DEBOUNCE_MS) || 1200;
  }

  function blobKey(t) {
    return GA.core.convoMerge.blobKey(t);
  }

  function turnKey(t) {
    return GA.core.convoMerge.turnKey(t);
  }

  // A live turn is capturable once it has a role and some real (normalized)
  // text. fp.len is the NORMALIZED length, so whitespace-only turns are
  // skipped along with empty ones — but a turn whose whole text is "0" isn't.
  // Skipping degrades to "captured on a later pass", never to a bad index.
  function valid(t) {
    return GA.core.convoMerge.wellFormed(t) && typeof t.text === "string" && t.fp.len > 0;
  }

  // snapshot() -> [{role, text, fp, head, order}] for every capturable turn
  // mounted right now, in DOM order. `head` (turnId.indexHead) is the bounded
  // normalized opening kept PLAINTEXT on the index entry: it is what lets a
  // later capture recognize this turn after its text grows, since a grown
  // turn's fingerprint never matches again (see upgradeStale).
  function snapshot() {
    return GA.turns
      .findTurns()
      .map(function (t) {
        const text = GA.turns.textOf(t.el);
        return { role: t.role, text: text, fp: GA.core.turnId.fingerprint(text) };
      })
      .filter(valid)
      .map(function (t, i) {
        return {
          role: t.role,
          text: t.text,
          fp: t.fp,
          head: GA.core.turnId.indexHead(t.text),
          order: i,
        };
      });
  }

  // Signature of the mounted transcript as of the last DURABLE state (saved,
  // or confirmed identical to the stored record). Uses turns.fingerprintOf's
  // per-element cache — invalidated per dirty turn by the reanchorer — so the
  // no-change pre-check costs findTurns + cached lookups, never a full-text
  // re-extraction or a record load. Turn count and total length join the
  // signature to blunt hash collisions: this gates WRITES, a stricter use
  // than anchor matching. Advances ONLY after a successful save (or a
  // confirmed no-change against a loaded record) — a failed quota write must
  // not turn every later capture into a false no-op.
  let lastDurableSig = null;

  function liveSignature() {
    if (!GA.turns) return null;
    const turns = GA.turns.findTurns();
    if (!turns.length) return null;
    let sig = turns.length + "|";
    let total = 0;
    for (const t of turns) {
      const fp = GA.turns.fingerprintOf(t.el);
      sig += fp.hash + ":" + fp.len + ",";
      total += fp.len;
    }
    return sig + "|" + total;
  }

  // Cheap structural identity of an index (no blobs): enough to know whether
  // a merge actually changed what would be stored.
  function indexSig(list) {
    return JSON.stringify(
      list.map(function (t) {
        return [t.role, t.fp.hash, t.fp.len, t.order, typeof t.head === "string" ? t.head : ""];
      }),
    );
  }

  // One load-merge-save pass. Gated to annotated conversations (>= 1 thread)
  // with a real session id — a pre-id draft or an unannotated chat never gets
  // a convo bucket.
  async function captureNow() {
    const ctrl = GA.threadController;
    if (!ctrl || ctrl.threads().length < 1) return; // annotated conversations only
    const session = GA.getSessionId();
    if (!session) return; // pre-id draft chat — never write a bogus bucket
    const sig = liveSignature();
    if (sig !== null && sig === lastDurableSig) return; // nothing changed since the last durable state
    const snap = snapshot();
    if (!snap.length) return; // nothing hydrated yet — nothing to add
    const existing = await GA.store.loadConvo(session); // RAW record: blobs stay compressed
    // Both halves of the stored record are healed on the way in, not trusted:
    // a malformed record (e.g. a hand-edited archive import) would otherwise
    // throw before every save, wedging capture for this conversation forever.
    const storedTurns = existing && Array.isArray(existing.turns) ? existing.turns : [];
    const storedBlobs =
      existing &&
      existing.blobs &&
      typeof existing.blobs === "object" &&
      !Array.isArray(existing.blobs)
        ? existing.blobs
        : null;
    const prior = storedTurns.filter(GA.core.convoMerge.wellFormed);
    const blobs = Object.assign({}, storedBlobs); // carried as-is
    let blobsChanged = false;
    for (const t of snap) {
      const k = blobKey(t);
      if (!(k in blobs)) {
        blobs[k] = await GA.core.compress.gzipToB64(t.text);
        blobsChanged = true;
      }
    }
    // Merging is licensed only when the snapshot's position against the
    // stored index is PROVABLE (the index is an ordered subsequence of the
    // snapshot, or the two sides share a unique adjacent pair) — see
    // core/convo-merge.js's isMergeProvable for the full rationale. When
    // unprovable, keep the index as-is and just bank the blobs — the next
    // overlapping capture indexes them in order.
    //
    // Provability is tested AFTER the stale-partial upgrade: a stored
    // mid-stream partial re-keyed to its completed live turn is what lets a
    // once-streaming conversation ever anchor again.
    const up = GA.core.convoMerge.upgradeStale(prior, snap);
    const anchored = GA.core.convoMerge.isMergeProvable(up.turns, snap);
    const turns = anchored
      ? GA.store.mergeTurns(
          up.turns,
          snap.map(function (t) {
            return { role: t.role, fp: t.fp, order: t.order, head: t.head };
          }),
        )
      : up.turns.map(function (t, i) {
          // healed index keeps order contiguous; head carried only when real
          const e = { role: t.role, fp: t.fp, order: i };
          if (typeof t.head === "string" && t.head) e.head = t.head;
          return e;
        });
    // Backfill heads onto entries that predate them (legacy records) whenever
    // the turn is mounted right now — merge anchors keep the EXISTING entry,
    // so without this a pre-head entry would never learn its head. Safe to
    // mutate: both branches above produce fresh clones.
    const headByKey = new Map(
      snap.map(function (t) {
        return [turnKey(t), t.head];
      }),
    );
    for (const t of turns) {
      if ((typeof t.head !== "string" || !t.head) && headByKey.has(turnKey(t)))
        t.head = headByKey.get(turnKey(t));
    }
    // A superseded partial's blob is unreachable once nothing in the index
    // references its key (the partial's fingerprint can never be seen in the
    // DOM again, so no future capture can re-index it). Referenced keys are
    // kept: identical text under another turn shares the same blob key.
    for (const k of up.replacedKeys) {
      if (
        !turns.some(function (t) {
          return blobKey(t) === k;
        })
      ) {
        delete blobs[k];
        blobsChanged = true;
      }
    }
    // Write only when the pass actually changed what would be stored — the
    // merge itself is the change detector (no post-hoc deep compare of a
    // multi-MB record). Healing (malformed entries filtered out) and a
    // renamed/relocated conversation count as changes.
    const changed =
      !existing ||
      blobsChanged ||
      storedTurns.length !== prior.length ||
      indexSig(turns) !== indexSig(prior) ||
      existing.title !== document.title ||
      existing.url !== location.href;
    if (!changed) {
      lastDurableSig = sig; // confirmed: DOM and stored record agree
      return;
    }
    await GA.store.saveConvo(session, {
      // Schema version stamp. Readers must treat a record WITHOUT `v` as v1
      // (records written before the stamp existed); see the record-shape
      // comment in store.js.
      v: 1,
      provider: GA.provider,
      id: session.slice(session.indexOf(":") + 1),
      title: document.title,
      url: location.href,
      capturedAt: Date.now(),
      turns: turns,
      blobs: blobs,
    });
    lastDurableSig = sig; // only after the save landed — a throw skips this
  }

  // Captures serialize through one promise chain (the store's own queue covers
  // single ops, not a whole load-merge-save): an immediate thread-create
  // capture overlapping a scheduled settle capture would otherwise both read
  // the same stored record and the slower save would clobber the faster one's
  // turns and blobs.
  let chain = Promise.resolve();
  const timedCapture = () => (GA.perf ? GA.perf.time("capture.cycle", captureNow) : captureNow());
  function capture() {
    const run = chain.then(timedCapture, timedCapture);
    chain = run.then(
      () => undefined,
      () => undefined, // one failed capture must not poison the chain
    );
    return run;
  }

  // Debounced trigger for the settle-driven paths (visit restore, streaming):
  // the reanchorer pings on every mutation frame, so capture runs once things
  // have been quiet for the debounce window. Thread creation does NOT go
  // through here — that capture is immediate, so the annotated turn survives
  // a fast tab close.
  let timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      capture().catch(function (e) {
        if (GA.warn) GA.warn("convo capture failed", e);
      });
    }, debounceMs());
  }

  // Another writer touched the stored record (convo-repair's head backfill on
  // export): the "nothing changed" pre-check compares the DOM against the
  // LAST STATE THIS MODULE saw, so an external write must clear it or the
  // next capture would falsely no-op and never upgrade stale entries.
  function invalidateBaseline() {
    lastDurableSig = null;
  }

  return { snapshot, capture, schedule, invalidateBaseline };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.convoCapture;
