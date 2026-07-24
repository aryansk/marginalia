# Performance test script

Manual verification for the perf program (phases in `docs/pending/perf.md`).
Run the full script once every phase has shipped; individual phase sections
also work standalone right after that phase lands. Record the numbers you
see in the Measurements section of `docs/pending/perf.md`.

Every check here is a NO-CHANGE check on behavior: if any step looks
different from before the program (not just slower/faster), that phase has a
transparency bug — file it, don't rationalize it.

## Setup (once)

1. **Back up first**: options page → Export. The test conversation's data is
   exactly what the capture/persist phases touch.
2. Options page → enable **debug logging**.
3. Open the heavy ChatGPT conversation (the one that used to freeze) with
   DevTools open. In the Console's context dropdown (top-left, says "top"),
   select the extension's content-script context (Marginalia) — `GA` is not
   reachable from the page context. Firefox: use the same dropdown in the
   split console.
4. Console helpers, from that context:

   ```js
   GA.perf.reset(); // start a clean measurement window
   GA.perf.snapshot(); // read {name: {count, total(ms), max(ms)}} on demand
   copy(JSON.stringify(GA.perf.snapshot(), null, 2)); // to clipboard
   ```

   Passive mode: just watch for `[marginalia perf]` summary lines (one every
   ~5s while anything is being measured).

## Phase 0 — instrumentation

| Step                                 | Expect                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Debug OFF, browse + stream an answer | zero `[marginalia perf]` output; `GA.perf.snapshot()` stays `{}`         |
| Debug ON, repeat                     | summaries appear; snapshot has `reanchor.frame`, `gutter.relayout`, etc. |

## Phase 1 — re-anchor hot path

1. **Stable stream**: with all threads anchored (no orphan styling), send a
   message to ChatGPT itself and let a long answer stream.
   - `reanchor.frame`: high count (every mutation frame) but `max` ≈ 0–1ms.
   - `reanchor.pass` and `turns.findTurns`: count stays LOW (not once per
     frame) — the futile-skip and no-orphan fast path are working.
2. **Orphan churn**: regenerate/edit a ChatGPT message that contains a
   highlight. Expect one short `reanchor.pass` burst, then quiet; the
   highlight re-attaches (or the box shows its orphan state) exactly as
   before the program.
3. **Permanent orphan**: leave one thread whose quoted text no longer exists
   on the page, then stream another answer. `reanchor.pass` must NOT fire
   per frame — a handful of counts only (skip engages between text changes).
4. **Self-wake filter**: scroll inside a comment box's messages area and
   inside the maximized modal for ~5s each. `reanchor.frame` count must not
   increase. Page scrolling must still increase it.
5. **Transparency**: highlights attach/detach, boxes follow anchors, and the
   above/below cue badges behave exactly as before.

## Phase 2 — startup

1. Reload the heavy conversation ×3. On each load:
   - No multi-second white/frozen tab; boxes appear promptly.
   - `restore.threads` total: record it. Target: well under a second on the
     heavy conversation (was: seconds to hang).
2. **Lazy-render transparency**:
   - An expanded box's visible messages area is fully painted on first
     sight — no blank strip, no visible late fill at the bottom.
   - Scroll an expanded box's messages to the very top immediately after
     load: the full history is there (oldest message present, nothing
     missing, no jump).
   - A collapsed chip shows the right message count; expanding it shows the
     full history instantly.
   - Open the maximized modal right after load: complete history.
3. **Draft sweep**: no visible change on load (this one is measurement-only:
   `restore.threads` and time-to-boxes are the signal).

## Phase 3 — capture & persistence

1. **Idle scroll**: with the conversation loaded and quiet, scroll around
   for 30s. `capture.cycle` count must stay at 0 (no-op pre-check) and no
   storage writes should occur (DevTools → Application → Storage viewer
   timestamps, if you want proof).
2. **After an answer**: ask a thread question, let it settle. Exactly one
   `capture.cycle`, with a total far below the old cost (record it). Then
   open the threads panel → export → verify the new turns are present in
   the transcript (capture still captures!).
3. **Durability**: create a new thread, then within ~1s switch tabs (fires
   visibilitychange flush) and close the tab. Reopen: the thread is there.
4. **Ordering**: ask two questions in quick succession in different threads;
   both answers persist and export correctly (background-compression path
   keeps the capture chain serialized).

## Phase 4 — streaming render

1. Ask a thread for a LONG, math-heavy answer (e.g. "derive X with lots of
   LaTeX, tables, and code blocks, at length").
   - `stream.render`: `max` stays flat (a few ms) from start to end of the
     stream — no growth as the answer gets longer, no end-of-answer freeze.
   - Early tokens appear at full rate; long-answer batching is not visually
     choppy.
2. **Equivalence check (the important one)**: after the answer settles,
   reload the page and compare the reloaded rendering of that message
   (full-parse path) against what you watched stream in (incremental path).
   They must be pixel-identical — headings, tables that formed mid-stream,
   nested/loose lists, fenced code, display math.
3. A stalled stream (network hiccup) must never leave text unrendered for
   more than a beat (trailing flush).

## Phase 5 — layout reads

1. **Fast continuous scroll** through the heavy conversation for ~10s
   (Chrome, anchored mode):
   - Boxes track their highlights smoothly (compositor — unchanged).
   - `gutter.relayout` count small (settle passes only, not per frame).
   - Cue badges ("N comments above/below") show correct counts each time
     you pause; they may update on pause rather than mid-flick — that is
     the one accepted visible-in-principle tradeoff. If it reads as wrong,
     flag it (the plan has a fallback).
2. Repeat in Firefox (JS-positioned mode): boxes must still track during
   scroll (this mode keeps real reads by design).
3. During a streaming answer with many threads: no sustained jank; frame
   summaries show relayout aligned to the render cadence.

## End-to-end acceptance (the actual goal)

On the heavy conversation, all phases shipped, debug ON for measurement then
OFF for feel:

1. Cold load → interactive boxes: no perceptible stall (previously: hang).
2. 10 minutes of normal use — asking in threads, streaming ChatGPT answers,
   scrolling, opening/closing the modal — with zero freezes.
3. Scale probe: import/duplicate threads (or use a throwaway conversation)
   toward ~100 threads and repeat 1–2. Load and streaming stay smooth;
   `reanchor.*`, `capture.cycle`, `stream.render`, `gutter.relayout` all
   stay bounded per the phase criteria above.
4. Transparency sweep with debug OFF: click through every surface (box,
   modal, panel, synthesis, labels, calm scrolling, composer) — everything
   looks and behaves exactly as it did before the program. The only change
   you should be able to detect is speed.

## Recording results

Append to `docs/pending/perf.md` → Measurements, per phase:

```
- P<n> (<commit>), <date>, <conversation size: N threads / T turns>:
  <metric>: count/total/max before → after
```

Before/after numbers for an already-shipped phase can be reconstructed by
checking out the prior commit locally (`git checkout <sha>~1`, load the
unpacked extension) — the instrumentation (P0) exists in every later commit.
