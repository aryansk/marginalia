// convo-merge.js — pure merge policy for the ga:convo:* transcript index,
// extracted from content/convo-capture.js so the licensing rules (WHEN a
// snapshot may be merged into the stored index, and HOW a stale mid-stream
// partial is re-keyed to its completed turn) are testable without a DOM or a
// store. No I/O and no compression here: everything operates on plain
// {role, fp:{hash,len}, order, head?} entries. The actual interleave stays
// GA.store.mergeTurns (backup.js) — this module only decides whether calling
// it is safe.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.convoMerge = (function () {
  function blobKey(t) {
    return t.fp.hash + ":" + t.fp.len;
  }

  // Same identity the interleave keys entries by (role:hash:len). Used to test
  // whether a snapshot overlaps the stored index at all.
  function turnKey(t) {
    return t.role + ":" + t.fp.hash + ":" + t.fp.len;
  }

  // An index entry must be fully formed before it may reach the merge:
  // mergeTurnLists deliberately carries no shape guard, so a malformed entry
  // would throw there — and since the stored record is merged on EVERY
  // capture, one poisoned entry (e.g. from an imported archive) would wedge
  // capture for that conversation forever. Applied to both sides of the merge.
  function wellFormed(t) {
    return !!(t && t.role && t.fp && typeof t.fp.hash === "number" && typeof t.fp.len === "number");
  }

  // Stale-partial upgrade. A turn indexed while it was still streaming (or
  // before late hydration) carries a fingerprint that will NEVER appear in the
  // DOM again, so without this pass neither anchoring condition below can ever
  // hold again: the index wedges forever at that first window while blobs keep
  // banking unindexed — the "export only contains the annotated turns" bug.
  //
  // A stored entry is a stale partial of a live turn when: same role, the live
  // turn is strictly LONGER, and the stored head is a prefix of the live head —
  // the signature of growth, and the same evidence the renderer's prefix-dedupe
  // (F3) already trusts to collapse partial+full pairs. The entry is upgraded
  // in place to the live identity. Matching is one-to-one, skips entries still
  // mounted verbatim, and never claims a live turn that some stored entry
  // already matches exactly (that would mint a phantom duplicate through the
  // multiset merge). Entries with no head (legacy records) are left alone; the
  // export path backfills their heads from the decompressed text.
  //
  // Returns { turns, replacedKeys }: replacedKeys are the superseded partials'
  // blob keys, deletable once nothing in the final index references them.
  function upgradeStale(prior, snap) {
    const snapKeys = new Set(snap.map(turnKey));
    const priorKeys = new Set(prior.map(turnKey));
    const claimed = new Set();
    const replacedKeys = [];
    const turns = prior.map(function (s) {
      if (typeof s.head !== "string" || !s.head) return s;
      if (snapKeys.has(turnKey(s))) return s; // still mounted verbatim — not stale
      for (const t of snap) {
        if (claimed.has(t) || priorKeys.has(turnKey(t))) continue;
        if (t.role !== s.role || t.fp.len <= s.fp.len) continue;
        if (t.head.slice(0, s.head.length) !== s.head) continue;
        claimed.add(t);
        replacedKeys.push(blobKey(s));
        return { role: s.role, fp: t.fp, order: s.order, head: t.head };
      }
      return s;
    });
    return { turns: turns, replacedKeys: replacedKeys };
  }

  // Is `a` an ordered subsequence of `b`? (Both are turn-key arrays.)
  function subsequence(a, b) {
    let j = 0;
    for (let i = 0; i < b.length && j < a.length; i++) if (b[i] === a[j]) j++;
    return j === a.length;
  }

  function pairCounts(keys) {
    const m = new Map();
    for (let i = 0; i + 1 < keys.length; i++) {
      // NUL separator: it can never occur inside a turn key, so a joined pair
      // can't alias into a different pair. (The original inline copy used a
      // raw NUL byte; the escape is the same string.)
      const k = keys[i] + "\u0000" + keys[i + 1];
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  // Do the two sides share an ADJACENT PAIR of turns, unique on both sides?
  function sharedUniquePair(a, b) {
    const pa = pairCounts(a);
    const pb = pairCounts(b);
    for (const [k, c] of pa) if (c === 1 && pb.get(k) === 1) return true;
    return false;
  }

  // Merging is licensed only when the snapshot's position against the stored
  // index is PROVABLE — a virtualized fling can jump between disjoint windows,
  // and a guessed merge is permanent corruption (a later bridging capture
  // duplicates whichever side was guessed wrong). Provable means either:
  //  (1) every stored turn is visible right now, in order (the stored index
  //      is an ordered subsequence of the snapshot): the merge simply
  //      re-reads the conversation — always safe; or
  //  (2) the two sides share an ADJACENT PAIR of turns, unique on both
  //      sides: a real window intersection. A single shared key is not
  //      enough — a repeated identical message ("continue") looks unique
  //      inside each of two genuinely disjoint windows.
  // Call with the post-upgradeStale index: a stored mid-stream partial
  // re-keyed to its completed live turn is what lets a once-streaming
  // conversation ever anchor again.
  function isMergeProvable(priorTurns, snapTurns) {
    if (!priorTurns.length) return true;
    const ka = priorTurns.map(turnKey);
    const kb = snapTurns.map(turnKey);
    return subsequence(ka, kb) || sharedUniquePair(ka, kb);
  }

  return {
    blobKey,
    turnKey,
    wellFormed,
    upgradeStale,
    subsequence,
    sharedUniquePair,
    isMergeProvable,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.convoMerge;
