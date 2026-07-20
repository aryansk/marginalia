// backup.js — pure export/merge-import engine for the portable thread archive.
// buildExport serializes every saved-threads bucket (ga:threads:*) and every
// conversation-transcript record (ga:convo:*) into a versioned JSON envelope;
// mergeImport folds an archive back into storage ADDITIVELY (merge mode never
// deletes local data); mergeTurnLists is the system's ONE order-preserving
// turn-index merge (store.js's mergeTurns delegates here). Everything in this
// file is pure and synchronous: no storage, no DOM, no clock, no compression —
// convo blobs are opaque strings carried verbatim.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

// Storage-key prefixes come from the shared schema — never re-stated here.
// Browser: shared/settings-schema.js loaded earlier set GA.schema. Node/tests:
// require it so this module stays importable on its own (the one test-env
// fallback in this file).
var gaSchema =
  GA.schema ||
  (typeof require !== "undefined" ? require("../shared/settings-schema.js") : undefined);

GA.core.backup = (function () {
  const FORMAT = "marginalia-threads";
  const VERSION = 1;
  const THREADS_PREFIX = gaSchema.THREADS_PREFIX;
  const CONVO_PREFIX = gaSchema.CONVO_PREFIX;

  // Archives are arbitrary user-supplied JSON; a bucket value with the wrong
  // shape is skipped rather than persisted (a restore must never poison storage).
  function isRecord(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  // Alignment key for a turn-index entry: role is included so a user message
  // and a model reply with identical text can never be mistaken for the same turn.
  function turnKey(t) {
    return t.role + ":" + t.fp.hash + ":" + t.fp.len;
  }

  // mergeTurnLists(existing, snapshot) -> new turns array. Both inputs are
  // (possibly partial) subsequences of the true conversation order — e.g. the
  // stored index vs. a fresh capture after a scroll-up revealed older turns.
  // Align them by LCS over turnKey so each entry matches AT MOST once (repeated
  // identical "continue" messages survive as a multiset); between anchors emit
  // existing-only entries then snapshot-only entries; renumber order 0..n-1.
  // Pure: never mutates inputs; idempotent: re-merging the same snapshot is a no-op.
  function mergeTurnLists(existing, snapshot) {
    const a = existing || [];
    const b = snapshot || [];
    const n = a.length;
    const m = b.length;
    const ka = a.map(turnKey);
    const kb = b.map(turnKey);

    // Classic LCS suffix table: dp[i][j] = LCS length of a[i:] vs b[j:].
    // Lists are at most a few hundred turns, so O(n*m) is fine.
    const dp = [];
    for (let i = n; i >= 0; i--) {
      dp[i] = [];
      for (let j = m; j >= 0; j--) {
        if (i === n || j === m) dp[i][j] = 0;
        else if (ka[i] === kb[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    // Walk the table once to collect the matched anchor pairs.
    const pairs = [];
    let x = 0;
    let y = 0;
    while (x < n && y < m) {
      if (ka[x] === kb[y] && dp[x][y] === dp[x + 1][y + 1] + 1) {
        pairs.push([x, y]);
        x++;
        y++;
      } else if (dp[x + 1][y] >= dp[x][y + 1]) {
        x++;
      } else {
        y++;
      }
    }

    // Emit segments: before each anchor, existing-only entries first, then
    // snapshot-only entries; the anchor itself is taken from `existing`.
    const out = [];
    let ai = 0;
    let bi = 0;
    function emitGap(aEnd, bEnd) {
      while (ai < aEnd) out.push(a[ai++]);
      while (bi < bEnd) out.push(b[bi++]);
    }
    for (const [pa, pb] of pairs) {
      emitGap(pa, pb);
      out.push(a[ai]);
      ai++;
      bi++;
    }
    emitGap(n, m);

    // Renumber on shallow clones so neither input entry is ever written to.
    return out.map((t, idx) => {
      const copy = Object.assign({}, t);
      copy.order = idx;
      return copy;
    });
  }

  // buildExport(all, exportedAt) -> archive envelope. `all` is the full object
  // from storage.local.get(); `exportedAt` is passed in by the caller (pure —
  // no clock in here). Buckets are selected by ALLOWLIST only, so the settings
  // record and any API key can never leak into an export by construction.
  // Convo record objects are carried verbatim — blobs stay compressed.
  function buildExport(all, exportedAt) {
    const src = all || {};
    const threads = {};
    const convos = {};
    for (const key of Object.keys(src)) {
      if (key.indexOf(THREADS_PREFIX) === 0) threads[key] = src[key];
      else if (key.indexOf(CONVO_PREFIX) === 0) convos[key] = src[key];
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: exportedAt,
      threads: threads,
      convos: convos,
    };
  }

  // Union one thread bucket (array of thread records) with the archived one.
  // Additive: every local record survives; archived records are appended or,
  // on an id collision, resolved content-max (more messages wins; a TIE keeps
  // the existing record verbatim). When the ARCHIVE record wins, only its
  // MESSAGES win: every field present on the LOCAL record is copied onto the
  // winner, so a restore never un-resolves a locally-resolved thread (fix F8)
  // and never relocates a working highlight (selector/anchor/section) or
  // re-stamps the local createdAt TTL clock (siege finding).
  function mergeThreadBucket(localArr, importedArr) {
    const local = Array.isArray(localArr) ? localArr : [];
    const imported = Array.isArray(importedArr) ? importedArr : [];
    const out = local.slice();
    // Null-prototype: record ids come from user JSON, so inherited names like
    // "__proto__" or "toString" must not read as phantom collisions (`in` on a
    // plain object would hit Object.prototype and corrupt the bucket array).
    const indexById = Object.create(null);
    for (let i = 0; i < out.length; i++) {
      if (out[i] && out[i].id != null) indexById[out[i].id] = i;
    }
    for (const rec of imported) {
      const id = rec && rec.id;
      if (id == null || !(id in indexById)) {
        out.push(rec);
        if (id != null) indexById[id] = out.length - 1;
        continue;
      }
      const at = indexById[id];
      const cur = out[at];
      const curLen = (cur && cur.messages ? cur.messages : []).length;
      const impLen = (rec.messages || []).length;
      if (impLen > curLen) {
        // Archive base (so archive-only fields arrive), local fields on top
        // (so no local data is ever lost), archive's fuller messages last.
        const winner = Object.assign({}, rec, cur);
        winner.messages = rec.messages;
        out[at] = winner;
      }
      // impLen <= curLen: keep the existing record verbatim.
    }
    return out;
  }

  // Merge one convo record with the archived one: turns interleave via
  // mergeTurnLists, blob maps union by their "<hash>:<len>" keys (identical
  // keys dedupe; the existing blob wins a conflict), metadata comes from the
  // record with the newer capturedAt (tie keeps existing). Blobs stay opaque.
  function mergeConvoRecord(localRec, importedRec) {
    if (!localRec) return importedRec;
    if (!importedRec) return localRec;
    const newerImported = (importedRec.capturedAt || 0) > (localRec.capturedAt || 0);
    const meta = newerImported ? importedRec : localRec;
    const merged = Object.assign({}, meta);
    merged.turns = mergeTurnLists(localRec.turns || [], importedRec.turns || []);
    // assign imported first so identical keys resolve to the existing blob.
    merged.blobs = Object.assign({}, importedRec.blobs || {}, localRec.blobs || {});
    return merged;
  }

  // mergeImport(existing, imported, {mode}) -> the next storage object to
  // write (never mutates either argument). mode "merge" (default) is additive;
  // mode "replace" overwrites archive-named buckets wholesale but leaves every
  // bucket the archive doesn't name intact. Throws on an unrecognized or
  // newer-than-supported envelope so a bad file can't silently corrupt storage.
  function mergeImport(existing, imported, opts) {
    const mode = (opts && opts.mode) || "merge";
    if (!imported || imported.format !== FORMAT) {
      throw new Error("backup: not a " + FORMAT + " archive");
    }
    // `!(v <= VERSION)` also rejects NaN, which `v > VERSION` would let through.
    if (typeof imported.version !== "number" || !(imported.version <= VERSION)) {
      throw new Error("backup: unsupported archive version " + imported.version);
    }
    const threads = imported.threads || {};
    const convos = imported.convos || {};
    const next = Object.assign({}, existing || {});
    // Bucket keys come from user-supplied JSON: only correctly-prefixed keys may
    // be written, so a crafted archive can never reach the settings/API-key
    // record (or any other non-thread key) through an import.
    function threadKeyOk(k) {
      return k.indexOf(THREADS_PREFIX) === 0;
    }
    function convoKeyOk(k) {
      return k.indexOf(CONVO_PREFIX) === 0;
    }
    if (mode === "replace") {
      for (const key in threads) {
        if (threadKeyOk(key) && Array.isArray(threads[key])) next[key] = threads[key];
      }
      for (const key in convos) {
        if (convoKeyOk(key) && isRecord(convos[key])) next[key] = convos[key];
      }
      return next;
    }
    for (const key in threads) {
      if (threadKeyOk(key) && Array.isArray(threads[key])) {
        next[key] = mergeThreadBucket(next[key], threads[key]);
      }
    }
    for (const key in convos) {
      if (convoKeyOk(key) && isRecord(convos[key])) {
        next[key] = mergeConvoRecord(next[key], convos[key]);
      }
    }
    return next;
  }

  return {
    FORMAT,
    VERSION,
    buildExport,
    mergeImport,
    mergeTurnLists,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.backup;
