# Marginalia — Privacy Policy

_Last updated: July 8, 2026_

Marginalia is a browser extension that adds margin comment threads to AI chat
sites (Gemini, ChatGPT, and Claude): you highlight text in an AI answer and ask
follow-up questions about it beside the page. This policy describes what data
the extension handles and where it goes.

**The short version: Marginalia has no server, no analytics, and no tracking.
Your data is stored only in your browser, and the only place anything is ever
sent is the AI service you are asking — at your request, when you ask it.**

## Data the extension sends

When you send a follow-up question, the extension composes a request containing:

- the text you highlighted,
- surrounding context from the AI answer (how much is controlled by the
  "context scope" setting: highlight only, the answer section, or the
  conversation),
- your question and the previous turns of that comment thread.

This request is sent to **one** destination — the AI backend answering it:

- **Signed-in session (default for Gemini and Claude):** the request goes to
  the same site you are already using (gemini.google.com or claude.ai), through
  your existing logged-in session, exactly as if you had asked in the page
  itself.
- **Official API (when you add your own API key in Settings):** the request
  goes to that provider's API — OpenAI (`api.openai.com`), Google AI
  (`generativelanguage.googleapis.com`), or Anthropic (`api.anthropic.com`) —
  authenticated with your key. ChatGPT follow-ups always use this path.

Once your question reaches the AI provider, its handling is governed by **that
provider's** privacy policy and terms, the same as anything else you send to
that provider.

Nothing is ever sent anywhere else. There is no first-party server, no
telemetry, no error reporting, no analytics, and no advertising or data
brokerage of any kind.

## Data the extension stores

All storage is local to your browser profile (`browser.storage.local`); none of
it is synced or uploaded:

- **Comment threads** — your questions and the AI's replies, keyed to the
  conversation they belong to, so they reappear when you reopen it.
- **Settings** — keyboard shortcut, context scope, and display preferences.
- **Optional API keys** — stored locally and attached only to requests sent to
  the matching provider. They are never sent anywhere else.

On gemini.google.com, signed-in mode also reads the page's own session data
(the tokens Gemini itself uses) to authenticate your request to Gemini. These
values are used only for that request and are not sent anywhere except
gemini.google.com.

## Deleting your data

- **Threads:** delete any thread from its comment box, or use **"Delete all
  saved threads"** in the extension's settings.
- **API keys:** clear the key fields in settings.
- **Everything:** uninstalling the extension removes all of its stored data.

## What the extension does not do

- No collection of browsing history, location, health, financial, or any data
  from sites other than the three supported chat sites.
- No selling, sharing, or transferring of data to third parties (the AI
  provider you are querying is the intended recipient of your question, not a
  third party in this sense).
- No use of data for any purpose other than the extension's single purpose:
  answering your follow-up questions in the margin.

## Changes

If a future version changes what data is handled, this policy will be updated
here, and the change will be visible in the repository's history.

## Contact

Questions about this policy: open an issue at
<https://github.com/midhunkrishna/marginalia/issues> or email
<kr1shn4.m1dhun@gmail.com>.
