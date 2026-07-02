import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Claude's web client does org lookup -> conversation create -> streamed
// completion. We stub all three by URL. api-util.js supplies the abort budget.

function sseStream(chunks) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length)
              return Promise.resolve({ value: new TextEncoder().encode(chunks[i++]), done: false });
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
}

function jsonRes(obj, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// routes: ordered [substring, response|fn]; first match wins (check "/completion"
// before "/chat_conversations" before "/api/organizations").
function routedFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    for (const [needle, resp] of routes) {
      if (url.indexOf(needle) !== -1) return typeof resp === "function" ? resp(url, opts) : resp;
    }
    throw new Error("no route for " + url);
  };
  fn.calls = calls;
  return fn;
}

function client(fetchFake) {
  return loadGA(
    ["src/background/api-util.js", "src/claude/parser.js", "src/claude/payload.js", "src/claude/client.js"],
    { fetch: fetchFake }
  ).claudeClient;
}

const OK_ORGS = [{ uuid: "org-1", capabilities: ["chat"] }];

describe("claudeClient.ask (web session)", () => {
  it("walks org -> conversation -> completion and streams the answer", async () => {
    const fetchFake = routedFetch([
      ["/completion", sseStream([
        'data: {"type":"content_block_delta","delta":{"text":"Hel"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":"lo"}}\n',
      ])],
      ["/chat_conversations", jsonRes({ uuid: "conv-1" })],
      ["/api/organizations", jsonRes(OK_ORGS)],
    ]);
    const chunks = [];
    const out = await client(fetchFake).ask({ prompt: "p" }, (t) => chunks.push(t));
    expect(out).toBe("Hello");
    expect(chunks[chunks.length - 1]).toBe("Hello");
    expect(fetchFake.calls.length).toBe(3);
    expect(fetchFake.calls[2].opts.signal).toBeDefined(); // completion is abortable
  });

  it("errors when the account can't be reached", async () => {
    const fetchFake = routedFetch([["/api/organizations", jsonRes({}, { ok: false, status: 403 })]]);
    await expect(client(fetchFake).ask({ prompt: "p" })).rejects.toThrow(/403/);
  });

  it("errors when no chat-capable org exists", async () => {
    const fetchFake = routedFetch([["/api/organizations", jsonRes([])]]);
    await expect(client(fetchFake).ask({ prompt: "p" })).rejects.toThrow(/Claude account/i);
  });

  it("errors on a non-OK completion response", async () => {
    const fetchFake = routedFetch([
      ["/completion", jsonRes({}, { ok: false, status: 500 })],
      ["/chat_conversations", jsonRes({ uuid: "conv-1" })],
      ["/api/organizations", jsonRes(OK_ORGS)],
    ]);
    await expect(client(fetchFake).ask({ prompt: "p" })).rejects.toThrow(/Claude request failed.*500/);
  });

  it("reports a timeout when a request aborts", async () => {
    const fetchFake = routedFetch([
      ["/api/organizations", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }],
    ]);
    await expect(client(fetchFake).ask({ prompt: "p" })).rejects.toThrow(/timed out/i);
  });
});
