# Performance program — pending items & status

Goal: lightning-fast at 100+ threads × 20+ messages on one conversation.
Hard rule: every phase is transparent — zero change in UI, UX, functionality,
or stored-data formats. One phase = one commit, measured before moving on
(debug setting on → `[marginalia perf]` summaries in the console).

Diagnosis (2026-07-24 audits): freezes come from work proportional to the
whole conversation (and its square) on hot paths — re-anchor O(N×T²) on the
mutation frame, whole-transcript capture cycles, restore that re-anchors and
re-renders everything at load, O(answer²) streaming re-parse, O(N) forced
rect reads per frame. No leaks; session memory is clean.

## Phases

| #   | Phase                                                                                                                                                                                                                                                                             | Status  | Acceptance                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| 0   | Perf instrumentation (`GA.perf`, debug-gated)                                                                                                                                                                                                                                     | shipped | numbers visible with debug on; zero overhead off                 |
| 1   | Re-anchor hot path O(changed): linear findTurns dedup, shared per-pass turns+text cache, futile-retry skip, self-mutation filter, connectivity-first orphan probe (throttled rect sweep), single scroll entry (+ignore extension-internal scrolls, passive listeners)             | shipped | reanchor measure ≈0 on stable frames; O(changed) during streams  |
| 2   | Startup proportional to visible: sweepDrafts getKeys (guarded), shared-cache restore, lazy message render (chips none; expanded renders at first measure until one viewport is covered + idle fill; flush on expand/scroll-up/refresh/destroy)                                     | shipped | load marks O(T + visible); no perceptible load stall             |
| 3   | Delta capture + off-thread gzip: fingerprint no-op pre-check (baseline advances only after successful save), merge-reported changed flag, background compression inside the existing serialize chain, debounced message-append persist (structural ops immediate; pagehide flush) | pending | capture ≈O(new turns); zero capture work on scroll               |
| 4   | Streaming render O(answer): tail-only re-parse (stable = blocks before last two at a blank-line boundary; equivalence fuzz test lands FIRST), TeX memo (mode+tex key), adaptive flush cadence with trailing flush                                                                 | pending | flush time flat as answer grows                                  |
| 5   | Layout reads O(change): frame-local rect cache with mutation generation counter, anchored-mode settle-only cues, relayout aligned to render window                                                                                                                                | pending | ~0 rect reads on scroll frames (anchored); ≤N on mutation frames |

Then: version bump + CHANGELOG ("performance release"), single entry.

## Cross-cutting guards

- Export a backup (options page) before smoke-testing on the real wedged
  conversation.
- jsdom geometry is all zeros — geometry-dependent tests must stub
  offsetHeight/clientHeight/scrollHeight/rects or they pass vacuously.
- No behavior/config flags for fallbacks; equivalence tests are the safety
  mechanism.
- Repo gotchas: two manifests kept equal by tests/build/wiring.test.js;
  never regenerate package-lock.json (hand-bump versions).

## Accepted tradeoffs (stated, invisible in practice)

- Fold-induced zero-rect orphans detected on the ~200ms settle pass instead
  of per frame (P1).
- ≤250ms message-append persist window on hard tab crash (P3) — comparable
  to today's crash-mid-write exposure.
- Cue badges refresh on scroll-pause (~200ms) rather than per scroll frame
  in anchored mode (P5) — fallback noted in plan if it ever reads as a
  change.

## Deferred (not transparent — revisit deliberately)

- CSS Custom Highlight API migration: would eliminate span-wrapping and the
  re-orphan churn entirely; needs visual/positioning parity validation.
- Storage format restructures (per-thread bucket keys, per-turn convo
  blobs): need reader migrations in backup/export/repair/panel.
- Pruning/TTL of stored transcripts: data-retention semantics change.
- Rejected by inversion: scroll-delta anchor tracking (inner scroller +
  nested scrollers make delta math unsound); dirty-turn _filtering_
  (correctness — replaced with search ordering).
- Dropped during P1 implementation: dirty-turn search ORDERING too — rung 1
  (fingerprint match) is already cheap via the WeakMap fingerprint cache, and
  rung 2's two-hits-refuse uniqueness rule requires an exhaustive scan, so
  early-accept would weaken correctness. Its benefit is delivered instead by
  the futile-retry skip in reanchorOrphans (same turns + same text + same
  orphans ⇒ provably same failure ⇒ skip).

## Verification

Full manual test script (per-phase + end-to-end): `docs/perf-test.md`.

## Measurements

(recorded per phase as they ship; baseline first)

- Baseline (pre-P1), real conversation: TBD after Phase 0 ships — capture
  `[marginalia perf]` summaries while streaming + on load.
