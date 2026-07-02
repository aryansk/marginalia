import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Fake browser.runtime: connect() returns a port whose postMessage triggers a
// scripted sequence of inbound messages via `script(req, send, disconnect)`.
// `port.disconnected` records that the content side hung up (stop/abort).
function fakeBrowser(script) {
  const ports = [];
  const b = {
    _ports: ports,
    runtime: {
      connect() {
        const listeners = [];
        const discons = [];
        const port = {
          disconnected: false,
          send: (m) => listeners.forEach((l) => l(m)),
          dropFromBackground: () => discons.forEach((d) => d()),
          onMessage: { addListener: (f) => listeners.push(f) },
          onDisconnect: { addListener: (f) => discons.push(f) },
          postMessage: (req) =>
            script(
              req,
              (m) => listeners.forEach((l) => l(m)),
              () => discons.forEach((d) => d())
            ),
          disconnect: () => {
            port.disconnected = true;
          },
        };
        ports.push(port);
        return port;
      },
    },
  };
  return b;
}

function service(script) {
  const browser = fakeBrowser(script);
  const GA = loadGA(["src/shared/protocol.js", "src/shared/config.js", "src/content/ask-service.js"], {
    browser,
  });
  return { svc: GA.askService, browser };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("askService.ask (Facade over the ask port)", () => {
  it("streams chunks then resolves with the final answer", async () => {
    const { svc } = service((req, send) => {
      send({ type: "chunk", text: "Hel" });
      send({ type: "chunk", text: "Hello" });
      send({ type: "done", text: "Hello" });
    });
    const chunks = [];
    const out = await svc.ask({ prompt: "p", tokens: { at: "t" } }, (t) => chunks.push(t)).result;
    expect(out).toBe("Hello");
    expect(chunks).toEqual(["Hel", "Hello"]);
  });

  it("falls back to the last chunk when 'done' carries no text", async () => {
    const { svc } = service((req, send) => {
      send({ type: "chunk", text: "partial" });
      send({ type: "done" });
    });
    expect(await svc.ask({ prompt: "p" }).result).toBe("partial");
  });

  it("rejects with the error message (and code) on an error frame", async () => {
    const { svc } = service((req, send) => send({ type: "error", message: "boom", code: "AUTH" }));
    const { result } = svc.ask({ prompt: "p" });
    await expect(result).rejects.toMatchObject({ message: "boom", code: "AUTH" });
  });

  it("forwards the provider + prompt + tokens over the port", async () => {
    let seen = null;
    const { svc } = service((req, send) => {
      seen = req;
      send({ type: "done", text: "ok" });
    });
    await svc.ask({ provider: "claude", prompt: "why 8kb?", tokens: { at: "AT" } }).result;
    expect(seen).toMatchObject({
      type: "ask",
      provider: "claude",
      prompt: "why 8kb?",
      tokens: { at: "AT" },
    });
  });

  it("stop() resolves with the accumulated partial text and hangs up the port", async () => {
    let send;
    const { svc, browser } = service((req, s) => {
      send = s;
    });
    const handle = svc.ask({ prompt: "p" });
    send({ type: "chunk", text: "partial ans" });
    handle.stop();
    expect(await handle.result).toBe("partial ans");
    expect(browser._ports[0].disconnected).toBe(true); // background aborts via onDisconnect
  });

  it("abort() rejects with an AbortError carrying the partial text", async () => {
    let send;
    const { svc, browser } = service((req, s) => {
      send = s;
    });
    const handle = svc.ask({ prompt: "p" });
    send({ type: "chunk", text: "partial" });
    handle.abort();
    await expect(handle.result).rejects.toMatchObject({ name: "AbortError", partialText: "partial" });
    expect(browser._ports[0].disconnected).toBe(true);
  });

  it("rejects when the background side disconnects mid-ask", async () => {
    let drop;
    const { svc } = service((req, send, disconnect) => {
      drop = disconnect;
    });
    const handle = svc.ask({ prompt: "p" });
    drop();
    await expect(handle.result).rejects.toThrow(/Connection to extension closed/);
  });

  it("watchdog rejects after prolonged silence, and pings keep it alive", async () => {
    vi.useFakeTimers();
    let send;
    const { svc } = service((req, s) => {
      send = s;
    });
    const handle = svc.ask({ prompt: "p" });
    const outcome = expect(handle.result).rejects.toThrow(/No response from the extension/);

    // Pings inside the window keep resetting the watchdog…
    vi.advanceTimersByTime(80000);
    send({ type: "ping" });
    vi.advanceTimersByTime(80000);
    send({ type: "ping" });
    // …then total silence past the budget kills it.
    vi.advanceTimersByTime(90001);
    await outcome;
  });

  it("a ping frame neither resolves nor emits a chunk", async () => {
    const chunks = [];
    const { svc } = service((req, send) => {
      send({ type: "ping" });
      send({ type: "chunk", text: "hi" });
      send({ type: "done", text: "hi" });
    });
    const out = await svc.ask({ prompt: "p" }, (t) => chunks.push(t)).result;
    expect(out).toBe("hi");
    expect(chunks).toEqual(["hi"]);
  });
});
