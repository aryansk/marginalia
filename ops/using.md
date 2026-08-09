# Using Marginalia

Marginalia adds private comment threads to answers on Gemini, ChatGPT, and
Claude. A thread is attached to the text you selected, so the conversation
stays beside the answer instead of changing the main chat.

## Start a thread

1. Open an AI conversation on a supported site and select text in an answer.
2. Click the floating **Comment** button that appears near the selection.
3. Type a question in the thread's **Ask a follow-up…** box and click **Ask**.
   Press Enter to submit, or Shift+Enter to add a new line. Cmd/Ctrl+Enter
   also submits.
4. Ask follow-up questions in the same box. **Stop** keeps the partial answer
   when a response is still streaming.

The selected text remains highlighted. Marginalia stores the thread for that
site and conversation, so it can reappear after a reload or when you return to
the conversation.

## Manage a thread

The controls in a thread let you:

- **Minimize** it to a compact chip, then click the chip to open it again.
- **Expand to full view** for a larger reading and composing surface.
- **Resolve** it when finished. Resolved threads are archived, not deleted,
  and can be reopened later.

Click the **All comment threads** button in the bottom-right corner of the
page, or press **Alt+Shift+A**. The panel has **Open**, **Resolved**, **All**,
and **Across chats** tabs. Use its search field to filter by highlighted text,
questions, answers, or labels; click a result to jump to it.

**Alt+Down** and **Alt+Up** cycle through threads. **Alt+Shift+C** collapses
all threads or expands them again. On macOS, use the Option key for Alt in
these shortcuts.

## Export and settings

The panel header contains two current controls:

- **Settings** opens Marginalia's options page.
- **Export for NotebookLM** downloads the current conversation and its
  annotations as Markdown.

You can also open the options page directly from the browser:

- Firefox: `about:addons` → Marginalia → **Preferences**
- Chrome: `chrome://extensions` → Marginalia → **Extension options**

In **Settings** you can change the keyboard shortcut and context scope, add
optional OpenAI, Google AI, or Anthropic API keys, enable the comment button,
configure calm scrolling, and export or import a full JSON backup. Without an
API key, Gemini and Claude can use the logged-in site session. ChatGPT requires
an OpenAI API key.

If a page re-renders an answer before its highlight is available, Marginalia
shows the thread under **Comments that lost their highlight** and retries as
the conversation becomes available; the thread is not silently deleted.
