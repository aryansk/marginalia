// undo-stack.js — composer-local undo/redo for a single textarea.
//
// `textarea.value = ""` on send (and a select-all-delete) wipes the browser's
// native undo history, and host pages (chatgpt.com, gemini.google.com,
// claude.ai) may hijack Ctrl+Z. So each composer keeps its OWN bounded snapshot
// stack (value + caret) and handles Ctrl/Cmd+Z itself.
//
//   GA.UndoStack(cap) -> pure, DOM-free stack:
//     { push(entry), undo(current), redo(current), size(), reset() }
//     undo/redo return the entry to restore, or undefined when there's nothing
//     to do (an empty-stack undo is a no-op so the event can fall through).
//   GA.attachComposerUndo(textarea, { onRestore }) -> { snapshot() }
//     wires input + keydown listeners on that ONE textarea. snapshot() captures
//     the current value+caret — call it right before any programmatic clear.
var GA = (typeof GA !== "undefined" && GA) || {};

// Pure bounded undo/redo stack. Each undo saves the caller-supplied `current`
// onto the redo stack (and vice-versa) so redo replays a linear history. A new
// push discards the redo stack (a fresh edit forks history). Over-cap pushes
// drop the OLDEST entry, keeping the newest `cap`.
GA.UndoStack = function (cap) {
  const max = cap && cap > 0 ? cap : 50;
  let undoArr = [];
  let redoArr = [];
  return {
    push(entry) {
      undoArr.push(entry);
      redoArr = [];
      if (undoArr.length > max) undoArr.shift();
    },
    undo(current) {
      if (!undoArr.length) return undefined;
      const entry = undoArr.pop();
      redoArr.push(current);
      return entry;
    },
    redo(current) {
      if (!redoArr.length) return undefined;
      const entry = redoArr.pop();
      undoArr.push(current);
      return entry;
    },
    size() {
      return undoArr.length;
    },
    reset() {
      undoArr = [];
      redoArr = [];
    },
  };
};

GA.attachComposerUndo = function (textarea, opts) {
  opts = opts || {};
  const stack = GA.UndoStack(50);
  // A burst-boundary checkpoint fires after this idle gap; a single deletion
  // that removes at least this many chars checkpoints immediately.
  const IDLE_MS = 400;
  const SHRINK = 12;
  let lastValue = textarea.value || "";
  let lastCaret = caret();
  let idleTimer = 0;

  function caret() {
    return typeof textarea.selectionStart === "number" ? textarea.selectionStart : (textarea.value || "").length;
  }
  function capture() {
    return { value: textarea.value, caret: caret() };
  }
  // Skip a push that duplicates the current stack top (repeated snapshot()s of
  // an unchanged value would otherwise pile up).
  function checkpoint(entry) {
    stack.push(entry);
  }

  function restore(entry) {
    textarea.value = entry.value; // programmatic .value fires no input event
    const c = Math.min(entry.caret || 0, entry.value.length);
    try {
      textarea.setSelectionRange(c, c);
    } catch (e) {
      /* detached / unsupported */
    }
    lastValue = entry.value;
    lastCaret = c;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
    opts.onRestore && opts.onRestore();
  }

  textarea.addEventListener("input", function () {
    const prev = lastValue;
    const prevCaret = lastCaret;
    const next = textarea.value;
    if (prev && next.length <= prev.length - SHRINK) {
      // A big deletion (e.g. select-all-delete) — checkpoint the pre-delete
      // value now so one Ctrl+Z brings it all back.
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = 0;
      }
      checkpoint({ value: prev, caret: prevCaret });
    } else if (!idleTimer) {
      // Otherwise checkpoint the pre-burst value once typing pauses.
      const pending = { value: prev, caret: prevCaret };
      idleTimer = setTimeout(function () {
        idleTimer = 0;
        checkpoint(pending);
      }, IDLE_MS);
    }
    lastValue = next;
    lastCaret = caret();
  });

  textarea.addEventListener("keydown", function (e) {
    if (e.altKey || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key ? e.key.toLowerCase() : "";
    const isZ = key === "z";
    const isY = key === "y";
    if (!isZ && !isY) return;
    const wantRedo = (isZ && e.shiftKey) || (isY && !e.shiftKey);
    const current = capture();
    const entry = wantRedo ? stack.redo(current) : stack.undo(current);
    if (entry === undefined) return; // nothing to do → let native behavior run
    e.preventDefault();
    e.stopPropagation();
    restore(entry);
  });

  return {
    // Capture the current state — call immediately before a programmatic clear
    // so focus + Ctrl+Z restores it.
    snapshot() {
      checkpoint(capture());
      lastValue = textarea.value;
      lastCaret = caret();
    },
  };
};

if (typeof module !== "undefined" && module.exports)
  module.exports = { UndoStack: GA.UndoStack, attachComposerUndo: GA.attachComposerUndo };
