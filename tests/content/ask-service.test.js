import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Fake browser.runtime: connect() returns a port whose postMessage triggers a
// scripted sequence of inbound messages via `script(req, send, disconnect)`.
function fakeBrowser(script) {
  return {
    runtime: {
      connect() {
        const listeners = [];
        const discons = [];
        return {
          onMessage: { addListener: (f) => listeners.push(f) },
          onDisconnect: { addListener: (f) => discons.push(f) },
          postMessage: (req) =>
            script(
              req,
              (m) => listeners.forEach((l) => l(m)),
              () => discons.forEach((d) => d())
            ),
          disconnect: () => {},
        };
      },
    },
  };
}

function service(script) {
  return loadGA(["src/shared/protocol.js", "src/content/ask-service.js"], {
    browser: fakeBrowser(script),
  }).askService;
}

describe("askService.ask (Facade over the ask port)", () => {
  it("streams chunks then resolves with the final answer", async () => {
    const svc = service((req, send) => {
      send({ type: "chunk", text: "Hel" });
      send({ type: "chunk", text: "Hello" });
      send({ type: "done", text: "Hello" });
    });
    const chunks = [];
    const out = await svc.ask({ prompt: "p", tokens: { at: "t" } }, (t) => chunks.push(t));
    expect(out).toBe("Hello");
    expect(chunks).toEqual(["Hel", "Hello"]);
  });

  it("falls back to the last chunk when 'done' carries no text", async () => {
    const svc = service((req, send) => {
      send({ type: "chunk", text: "partial" });
      send({ type: "done" });
    });
    expect(await svc.ask({ prompt: "p" })).toBe("partial");
  });

  it("rejects with the error message on an error frame", async () => {
    const svc = service((req, send) => send({ type: "error", message: "boom" }));
    await expect(svc.ask({ prompt: "p" })).rejects.toThrow("boom");
  });

  it("forwards the provider + prompt + tokens over the port", async () => {
    let seen = null;
    const svc = service((req, send) => {
      seen = req;
      send({ type: "done", text: "ok" });
    });
    await svc.ask({ provider: "claude", prompt: "why 8kb?", tokens: { at: "AT" } });
    expect(seen).toMatchObject({
      type: "ask",
      provider: "claude",
      prompt: "why 8kb?",
      tokens: { at: "AT" },
    });
  });
});
