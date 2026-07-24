// convo-repair.js — load a ga:convo:* record DECODED, self-healing it on the
// way out. THE system's sole decompress site: capture, store and backup all
// carry message blobs as opaque compressed strings; only this module ever
// calls GA.core.compress.b64ToText. Extracted from the panel's export handler
// so the decode + repair policy is testable apart from download/clipboard
// delivery.
//
// GA.convoRepair.loadDecoded(session) -> Promise<null | { provider, id,
//   title, url, capturedAt, turns: [{role, order, fp, text}] }>
// Returns null when the session is falsy, no record exists, or the record has
// no turns. Two repairs ride along, both best-effort (their failure never
// blocks the caller):
//  - corrupt blobs (fail to inflate) are deleted so the next capture can
//    re-compress the message from the live DOM;
//  - headless legacy index entries get their `head` backfilled from the
//    decompressed plaintext — the only place it is ever in hand.
var GA = (typeof GA !== "undefined" && GA) || {};

GA.convoRepair = (function () {
  async function loadDecoded(session) {
    const raw = session ? await GA.store.loadConvo(session) : null;
    const rawTurns = raw && Array.isArray(raw.turns) ? raw.turns : [];
    if (!rawTurns.length) return null;
    const blobs =
      raw.blobs && typeof raw.blobs === "object" && !Array.isArray(raw.blobs) ? raw.blobs : {};
    const corrupt = [];
    // Heads for index entries that predate them (records captured before the
    // stale-partial upgrade existed). Capture can't compute these — it never
    // decompresses — but right here the plaintext is in hand, and a headless
    // entry is exactly what keeps a legacy wedged record from ever
    // re-anchoring. Keyed role:hash:len, the same identity capture matches by.
    const heads = new Map();
    const turns = [];
    for (const t of rawTurns) {
      const entry = t && typeof t === "object" ? t : {};
      const key = entry.fp ? entry.fp.hash + ":" + entry.fp.len : null;
      const blob = key != null && blobs[key] != null ? blobs[key] : null;
      let text = ""; // a missing blob degrades to an empty turn, never a throw
      if (blob != null) {
        try {
          text = await GA.core.compress.b64ToText(blob);
        } catch (e) {
          corrupt.push(key); // corrupt blob: degrade AND self-heal below
        }
      }
      if (text && entry.role && key != null && (typeof entry.head !== "string" || !entry.head)) {
        heads.set(entry.role + ":" + key, GA.core.turnId.indexHead(text));
      }
      turns.push({ role: entry.role, order: entry.order, fp: entry.fp, text: text });
    }
    // Fix F5 — self-heal: a blob that provably fails to inflate carries no
    // recoverable data, and capture skips keys that EXIST, so deleting the
    // entry is exactly what lets the next capture re-compress the message
    // from the live DOM. Best-effort in its own catch — a heal failure must
    // not block the export. Merely-MISSING blobs are never touched (nothing
    // to heal). The record is RE-LOADED right before the write: the
    // decompress loop above awaited for arbitrarily long, and a concurrent
    // capture may have re-written the record — saving our stale snapshot
    // would silently revert its freshly banked turns/blobs. The re-read
    // narrows that race to microtasks (storage.local has no transactions;
    // capture-vs-capture accepts the same residual window). A vanished or
    // malformed fresh record means there is nothing to heal — never write
    // the stale snapshot back.
    if (corrupt.length || heads.size) {
      try {
        const fresh = await GA.store.loadConvo(session);
        let dirty = false;
        if (
          corrupt.length &&
          fresh &&
          fresh.blobs &&
          typeof fresh.blobs === "object" &&
          !Array.isArray(fresh.blobs)
        ) {
          corrupt.forEach((k) => delete fresh.blobs[k]);
          dirty = true;
        }
        // Head backfill writes into the RE-LOADED record for the same reason
        // the heal does; an entry a concurrent capture already gave a head
        // (or removed) is simply left alone.
        if (heads.size && fresh && Array.isArray(fresh.turns)) {
          for (const t of fresh.turns) {
            if (!t || typeof t !== "object" || !t.role || !t.fp) continue;
            if (typeof t.head === "string" && t.head) continue;
            const h = heads.get(t.role + ":" + t.fp.hash + ":" + t.fp.len);
            if (h) {
              t.head = h;
              dirty = true;
            }
          }
        }
        if (dirty) {
          await GA.store.saveConvo(session, fresh);
          // The capture pre-check compares the DOM against the last record
          // state IT saw — this external write must clear that baseline.
          if (GA.convoCapture && GA.convoCapture.invalidateBaseline)
            GA.convoCapture.invalidateBaseline();
        }
      } catch (e) {
        GA.warn("transcript self-heal failed", e);
      }
    }
    return {
      provider: raw.provider,
      id: raw.id,
      title: raw.title,
      url: raw.url,
      capturedAt: raw.capturedAt,
      turns: turns,
    };
  }

  return { loadDecoded };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.convoRepair;
