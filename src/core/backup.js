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

GA.core.backup = (function () {
  var FORMAT = "marginalia-threads";
  var VERSION = 1;
  var THREADS_PREFIX = (GA.schema && GA.schema.THREADS_PREFIX) || "ga:threads:";
  // CONVO_PREFIX joins the schema when transcript capture lands; fall back so
  // this module works (and round-trips convo buckets) either way.
  var CONVO_PREFIX = (GA.schema && GA.schema.CONVO_PREFIX) || "ga:convo:";

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
    var a = existing || [];
    var b = snapshot || [];
    var n = a.length;
    var m = b.length;
    var ka = a.map(turnKey);
    var kb = b.map(turnKey);

    // Classic LCS suffix table: dp[i][j] = LCS length of a[i:] vs b[j:].
    // Lists are at most a few hundred turns, so O(n*m) is fine.
    var dp = [];
    for (var i = n; i >= 0; i--) {
      dp[i] = [];
      for (var j = m; j >= 0; j--) {
        if (i === n || j === m) dp[i][j] = 0;
        else if (ka[i] === kb[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    // Walk the table once to collect the matched anchor pairs.
    var pairs = [];
    var x = 0;
    var y = 0;
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
    var out = [];
    var ai = 0;
    var bi = 0;
    function emitGap(aEnd, bEnd) {
      while (ai < aEnd) out.push(a[ai++]);
      while (bi < bEnd) out.push(b[bi++]);
    }
    for (var p = 0; p < pairs.length; p++) {
      emitGap(pairs[p][0], pairs[p][1]);
      out.push(a[ai]);
      ai++;
      bi++;
    }
    emitGap(n, m);

    // Renumber on shallow clones so neither input entry is ever written to.
    return out.map(function (t, idx) {
      var copy = Object.assign({}, t);
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
    var src = all || {};
    var threads = {};
    var convos = {};
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
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
    var local = Array.isArray(localArr) ? localArr : [];
    var imported = Array.isArray(importedArr) ? importedArr : [];
    var out = local.slice();
    // Null-prototype: record ids come from user JSON, so inherited names like
    // "__proto__" or "toString" must not read as phantom collisions (`in` on a
    // plain object would hit Object.prototype and corrupt the bucket array).
    var indexById = Object.create(null);
    for (var i = 0; i < out.length; i++) {
      if (out[i] && out[i].id != null) indexById[out[i].id] = i;
    }
    for (var j = 0; j < imported.length; j++) {
      var rec = imported[j];
      var id = rec && rec.id;
      if (id == null || !(id in indexById)) {
        out.push(rec);
        if (id != null) indexById[id] = out.length - 1;
        continue;
      }
      var at = indexById[id];
      var cur = out[at];
      var curLen = (cur && cur.messages ? cur.messages : []).length;
      var impLen = (rec.messages || []).length;
      if (impLen > curLen) {
        // Archive base (so archive-only fields arrive), local fields on top
        // (so no local data is ever lost), archive's fuller messages last.
        var winner = Object.assign({}, rec, cur);
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
    var newerImported = (importedRec.capturedAt || 0) > (localRec.capturedAt || 0);
    var meta = newerImported ? importedRec : localRec;
    var merged = Object.assign({}, meta);
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
    var mode = (opts && opts.mode) || "merge";
    if (!imported || imported.format !== FORMAT) {
      throw new Error("backup: not a " + FORMAT + " archive");
    }
    // `!(v <= VERSION)` also rejects NaN, which `v > VERSION` would let through.
    if (typeof imported.version !== "number" || !(imported.version <= VERSION)) {
      throw new Error("backup: unsupported archive version " + imported.version);
    }
    var threads = imported.threads || {};
    var convos = imported.convos || {};
    var next = Object.assign({}, existing || {});
    var key;
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
      for (key in threads) {
        if (threadKeyOk(key) && Array.isArray(threads[key])) next[key] = threads[key];
      }
      for (key in convos) {
        if (convoKeyOk(key) && isRecord(convos[key])) next[key] = convos[key];
      }
      return next;
    }
    for (key in threads) {
      if (threadKeyOk(key) && Array.isArray(threads[key])) {
        next[key] = mergeThreadBucket(next[key], threads[key]);
      }
    }
    for (key in convos) {
      if (convoKeyOk(key) && isRecord(convos[key])) {
        next[key] = mergeConvoRecord(next[key], convos[key]);
      }
    }
    return next;
  }

  return {
    FORMAT: FORMAT,
    VERSION: VERSION,
    buildExport: buildExport,
    mergeImport: mergeImport,
    mergeTurnLists: mergeTurnLists,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.backup;
