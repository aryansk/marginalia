# Marginalia features, version by version

What Marginalia can do for you, in plain language — newest first. For
install and day-to-day usage instructions, see
[`ops/using.md`](../ops/using.md).

---

## 0.3.0 — Labels & "ask across your chats"

_The organizing release: tag the answers worth keeping, then search — and
question — everything you've ever annotated, across every conversation._

- **Label anything.** Highlight part of an AI answer and tag it instead of
  (or as well as) discussing it. Click the small **tag button** on a comment
  box, or type `/label mytag` in its message field. Labels look like little
  violet tags, so they never get mixed up with your comment threads.
- **Two kinds of labels.**
  - Tag a highlight **without starting a discussion** — the comment box turns
    into a compact tag chip in the margin, marking that answer for later.
  - Or add labels **to an existing discussion thread** — they appear as small
    tags at the top of the thread.
- **Organize with dots.** Labels can have families: `project.ux` and
  `project.research` both belong to `project`. Later, picking `project`
  finds everything underneath it.
- **Edit tags anywhere, the same way.** Every tag has a little **×** to
  remove it and a field to add more. Click a tag chip (or the pencil on a
  thread) to edit.
- **The "Across chats" tab.** The threads panel (the button in the bottom
  right corner) gained a new tab that sees **all** your conversations at
  once, on that AI site:
  - Search every discussion you've ever had, by any word in it.
  - Or switch to **Labels** and pick tags — everything carrying them lines
    up, ready to check on or off.
- **Ask a question across your selection.** Pick a few discussions and
  labeled answers, then type a prompt like _"summarize these"_ or _"what
  patterns keep coming up?"_. Marginalia bundles them up, asks the AI you're
  on, and streams the answer right there in the panel. Ask follow-ups —
  earlier answers stay on screen.
- **Take the answer with you.** Two buttons under every result:
  - **Copy & open new chat** — copies the answer and opens a fresh chat on
    the site, ready for you to paste and continue.
  - **Download .md** — saves the answer as a tidy Markdown file, with a note
    of when it was made and which items went into it.

## 0.2.2 — A roomier full-screen view

- **Resize the full-screen thread view** by dragging its edges — it remembers
  your width for the rest of the visit.
- **No more missed replies.** Open a thread full-screen while an answer is
  still being written and the text flows straight in, mid-sentence.
- While a thread is full-screen, its margin box tucks itself away and comes
  back exactly as it was when you close the big view.

## 0.2.1 — Math that reads like math

- Formulas in AI answers (the `\frac{a}{b}`-style notation) now display as
  **real math symbols** — fractions, Greek letters, superscripts — instead of
  raw code, in both the margin boxes and the full-screen view.

## 0.2.0 — Your annotations, safe and portable

- **Whole conversations are kept.** Any conversation you annotate is quietly
  saved as a transcript on your computer, filling in as you scroll and
  revisit — even on sites that only show part of a long chat at a time.
- **Export for NotebookLM (or any notes app).** One click in the threads
  panel downloads the conversation **plus your comments** as a clean
  Markdown document — your annotations appear as notes right under the
  answers they were written on. It's copied to your clipboard too.
- **Backup and restore.** From the settings page, export everything —
  threads and transcripts — to a single file, and bring it back later or on
  another computer. Restoring merges safely; it never touches your settings
  or API keys.
- Sturdier storage all around: drafts aren't lost when a chat doesn't get a
  web address yet, and one damaged record can no longer hide the rest of
  your annotations.

## 0.1.1 — Finding your way around

- **Search your threads** from the panel by any word in a highlight,
  question, or answer.
- **Focus mode**: opening one thread neatly tucks the others away.
- Undo (Ctrl+Z) in the message field brings back text you deleted or sent.
- Sturdier highlight anchoring — comments find their exact sentence again
  after a reload, and refuse to guess when the page has changed too much.
- A calmer, flatter look that matches each site's colors, and the panel
  button moved to the bottom-right corner. Renamed to **Marginalia**.

## 0.1.0 — The idea

- **Comment threads in the margin** of Gemini, ChatGPT, and Claude:
  highlight any part of an answer and ask about **just that part** — the
  reply streams into a small box beside the page, and your main chat stays
  untouched.
- Threads are real conversations: ask follow-ups, minimize boxes to chips,
  resolve them when done, reopen them later. Everything is saved per
  conversation and comes back when you return.
- Works with your **logged-in session** on Gemini and Claude out of the box;
  add an API key in Settings for the official route (required for ChatGPT).
- Available for **Firefox and Chrome**.
