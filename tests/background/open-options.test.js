import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// MSG_OPEN_OPTIONS routing (T-006): background.js gains a SEPARATE, ungated
// onMessage listener that opens the options page. It must be reachable from
// any supported site (the existing token router is gemini-sender-gated) and
// must return undefined for every message so it never hijacks another
// handler's sendResponse channel.

function loadBackground() {
  const onMessage = [];
  const calls = { openOptionsPage: 0, executeScript: 0 };
  const browser = {
    runtime: {
      id: "ext-id",
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onConnect: { addListener() {} },
      onMessage: {
        addListener(fn) {
          onMessage.push(fn);
        },
      },
      openOptionsPage() {
        calls.openOptionsPage++;
        return Promise.resolve();
      },
    },
    contextMenus: {
      removeAll: () => Promise.resolve(),
      create() {},
      onClicked: { addListener() {} },
    },
    tabs: { sendMessage: () => Promise.resolve() },
    scripting: {
      executeScript() {
        calls.executeScript++;
        return Promise.resolve([{ result: {} }]);
      },
    },
    storage: { local: { get: () => Promise.resolve({}) } },
  };
  const GA = loadGA(
    ["src/shared/protocol.js", "src/shared/hosts.js", "src/shared/config.js", "src/background.js"],
    { browser },
  );
  // deliver like the browser would: every onMessage listener sees the message
  const dispatch = (msg, sender) => onMessage.map((fn) => fn(msg, sender));
  return { GA, browser, calls, onMessage, dispatch };
}

// a content-script sender from a NON-gemini site (claude.ai)
const CLAUDE_SENDER = { id: "ext-id", tab: { id: 7, url: "https://claude.ai/chat/abc" } };

describe("background MSG_OPEN_OPTIONS routing", () => {
  it("opens the options page for MSG_OPEN_OPTIONS from any supported site (not gemini-gated)", () => {
    const { GA, calls, dispatch } = loadBackground();
    dispatch({ type: GA.protocol.MSG_OPEN_OPTIONS }, CLAUDE_SENDER);
    expect(calls.openOptionsPage).toBe(1);
  });

  it("every listener returns undefined for MSG_OPEN_OPTIONS (no sendResponse hijack)", () => {
    const { GA, dispatch } = loadBackground();
    const returns = dispatch({ type: GA.protocol.MSG_OPEN_OPTIONS }, CLAUDE_SENDER);
    expect(returns.every((r) => r === undefined)).toBe(true);
  });

  it("ignores unrelated message types and null messages", () => {
    const { calls, dispatch } = loadBackground();
    const returns = [
      ...dispatch({ type: "something-else" }, CLAUDE_SENDER),
      ...dispatch(null, CLAUDE_SENDER),
    ];
    expect(calls.openOptionsPage).toBe(0);
    expect(returns.every((r) => r === undefined)).toBe(true);
  });

  it("does not disturb the token router: MSG_OPEN_OPTIONS never triggers executeScript", () => {
    const { GA, calls, dispatch } = loadBackground();
    dispatch({ type: GA.protocol.MSG_OPEN_OPTIONS }, CLAUDE_SENDER);
    expect(calls.executeScript).toBe(0);
  });

  it("token router still works: MSG_READ_TOKENS from gemini runs executeScript, not options", () => {
    const { GA, calls, dispatch } = loadBackground();
    const gemini = { id: "ext-id", tab: { id: 3, url: "https://gemini.google.com/app" } };
    dispatch({ type: GA.protocol.MSG_READ_TOKENS }, gemini);
    expect(calls.executeScript).toBe(1);
    expect(calls.openOptionsPage).toBe(0);
  });
});
