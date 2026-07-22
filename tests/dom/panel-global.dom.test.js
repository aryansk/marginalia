// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";
import { stubGlobalDownloads } from "../helpers/download-stub.js";

// The panel's "All chats" tab: cross-conversation thread search, the
// namespace-grouped label picker with curation, and the synthesis flow
// (bundle → askFlow → streamed output → Start-a-conversation / Download).

const TURN = "The full labeled model answer, straight from the transcript.";

function makeGA() {
  const GA = loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/labels.js",
      "src/core/thread-search.js",
      "src/core/global-search.js",
      "src/core/turn-id.js",
      "src/core/bundle-prompt.js",
      "src/core/markdown-ast.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/markdown.js",
      "src/content/stream-view.js",
      "src/content/dialog.js",
      "src/content/undo-stack.js",
      "src/content/composer.js",
      "src/content/panel.js",
    ],
    {
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
  GA.warn = vi.fn();
  GA.provider = "gemini";
  GA.threadController = { threads: () => [], expandThreadById: vi.fn() };
  GA.selection = { anchorEl: () => null };
  GA.gutter = { get: () => null, setActive: vi.fn(), mode: () => "normal" };

  const fp = GA.core.turnId.fingerprint(TURN);
  const buckets = [
    {
      session: "gemini:one",
      threads: [
        {
          id: "t1",
          selector: { exact: "quantum decay" },
          messages: [{ role: "user", text: "why so fast?" }],
          labels: ["physics.qft"],
        },
        {
          id: "lab1",
          kind: "label",
          selector: { exact: "labeled passage" },
          anchor: { v: 2, role: "model", turn: fp },
          labels: ["physics.qft", "todo"],
          messages: [],
          section: "stored section fallback",
        },
      ],
    },
    {
      session: "chatgpt:two",
      threads: [{ id: "t2", selector: { exact: "css anchors" }, messages: [] }],
    },
  ];
  GA.store = {
    listThreadBuckets: vi.fn(async () => buckets),
    loadConvo: vi.fn(async (session) =>
      session === "gemini:one" ? { v: 1, title: "Physics chat", turns: [], blobs: {} } : null,
    ),
  };
  GA.convoRepair = {
    loadDecoded: vi.fn(async (session) =>
      session === "gemini:one" ? { turns: [{ role: "model", fp, text: TURN }] } : null,
    ),
  };

  // Controllable askFlow double.
  GA.askFlow = {
    lastPrompt: null,
    onChunk: null,
    resolve: null,
    reject: null,
    ask: vi.fn((prompt, onChunk) => {
      GA.askFlow.lastPrompt = prompt;
      GA.askFlow.onChunk = onChunk;
      const handle = {
        result: new Promise((res, rej) => {
          GA.askFlow.resolve = res;
          GA.askFlow.reject = rej;
        }),
        stop: vi.fn(),
        abort: vi.fn(),
      };
      GA.askFlow.lastHandle = handle;
      return handle;
    }),
  };
  return GA;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function openGlobal(GA) {
  GA.panel.open();
  document.querySelector('[data-filter="global"]').click();
  await tick(); // bucket listing resolves + re-render
  return document.querySelector(".ga-panel");
}

const rows = () => Array.from(document.querySelectorAll(".ga-panel-row-select"));
const rowByText = (text) => rows().find((r) => r.textContent.includes(text));
const footer = () => document.querySelector(".ga-panel-foot");

describe("All chats — threads mode", () => {
  it("shows the type dropdown only on the global tab and lists threads across conversations", async () => {
    const GA = makeGA();
    GA.panel.open();
    expect(document.querySelector(".ga-panel-type").classList.contains("ga-panel-type-on")).toBe(
      false,
    );
    document.querySelector('[data-filter="global"]').click();
    expect(document.querySelector(".ga-panel-type").classList.contains("ga-panel-type-on")).toBe(
      true,
    );
    await tick();
    // conversation threads from BOTH sessions; the standalone label is not a thread
    expect(rows()).toHaveLength(2);
    expect(rowByText("quantum decay")).toBeTruthy();
    expect(rowByText("css anchors")).toBeTruthy();
    expect(rowByText("labeled passage")).toBeFalsy();
    // old tabs still render the per-conversation view
    document.querySelector('[data-filter="open"]').click();
    expect(document.querySelector(".ga-modal-empty").textContent).toContain("No threads here");
  });

  it("search narrows across conversations; selection reveals the prompt footer", async () => {
    const GA = makeGA();
    await openGlobal(GA);
    const input = document.querySelector(".ga-panel-search-input");
    input.value = "css";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(rows()).toHaveLength(1);
    expect(footer().classList.contains("ga-panel-foot-on")).toBe(false);

    rowByText("css anchors").click();
    expect(footer().classList.contains("ga-panel-foot-on")).toBe(true);
    expect(footer().textContent).toContain("1 item selected");
    expect(footer().querySelector(".ga-composer")).toBeTruthy();
  });
});

describe("All chats — labels mode", () => {
  async function toLabelsMode() {
    const select = document.querySelector(".ga-panel-type");
    select.value = "labels";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  }

  it("groups labels by namespace and lists prefix-matched items pre-checked for curation", async () => {
    const GA = makeGA();
    await openGlobal(GA);
    await toLabelsMode();

    const groups = Array.from(document.querySelectorAll(".ga-panel-group"), (g) => g.textContent);
    expect(groups).toContain("physics");
    expect(groups).toContain("labels"); // bare group ("todo")

    // picking the whole "physics.qft" label matches the thread AND the label record
    rowByText("physics.qft").click();
    expect(footer().textContent).toContain("2 items selected");
    const matched = rowByText("labeled passage");
    expect(matched).toBeTruthy();
    expect(matched.querySelector(".ga-panel-check").checked).toBe(true);

    // curate one out
    rowByText("quantum decay").click();
    expect(footer().textContent).toContain("1 item selected");
  });
});

describe("All chats — synthesis", () => {
  async function selectAndAsk(GA, instruction = "summarize the bundle") {
    await openGlobal(GA);
    const select = document.querySelector(".ga-panel-type");
    select.value = "labels";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    rowByText("physics.qft").click(); // thread t1 + label lab1
    const composer = footer().querySelector(".ga-input");
    composer.value = instruction;
    footer().querySelector(".ga-send").click();
    await tick(); // bundle resolution (loadConvo/loadDecoded) + ask
    return instruction;
  }

  it("bundles the labeled turn's transcript text + the thread discussion into one prompt", async () => {
    const GA = makeGA();
    await selectAndAsk(GA);
    const prompt = GA.askFlow.lastPrompt;
    expect(prompt).toContain("2 excerpts");
    expect(prompt).toContain("you (Gemini)");
    expect(prompt).toContain(TURN); // fingerprint-resolved via the decoded fallback
    expect(prompt).toContain("Me: why so fast?");
    expect(prompt).toContain("Labels: physics.qft, todo");
    expect(prompt).toContain("Conversation: Physics chat");
    expect(prompt).toContain("summarize the bundle");
  });

  it("streams chunks into the output, then reveals the output actions on settle", async () => {
    const GA = makeGA();
    await selectAndAsk(GA);
    GA.askFlow.onChunk("partial…");
    expect(document.querySelector(".ga-panel-output").textContent).toContain("partial…");
    expect(
      document
        .querySelector(".ga-panel-output-actions")
        .classList.contains("ga-panel-output-actions-on"),
    ).toBe(false);

    GA.askFlow.resolve("## Final synthesis");
    await tick();
    expect(document.querySelector(".ga-panel-output").textContent).toContain("Final synthesis");
    expect(
      document
        .querySelector(".ga-panel-output-actions")
        .classList.contains("ga-panel-output-actions-on"),
    ).toBe(true);
  });

  it("a stop (AbortError) keeps the partial text as usable output", async () => {
    const GA = makeGA();
    await selectAndAsk(GA);
    GA.askFlow.onChunk("partial answer");
    GA.askFlow.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await tick();
    expect(
      document
        .querySelector(".ga-panel-output-actions")
        .classList.contains("ga-panel-output-actions-on"),
    ).toBe(true);
    expect(document.querySelector(".ga-error-card")).toBeFalsy();
  });

  it("a real failure renders the error card and keeps the actions hidden", async () => {
    const GA = makeGA();
    await selectAndAsk(GA);
    GA.askFlow.reject(new Error("NETWORK down"));
    await tick();
    expect(document.querySelector(".ga-error-card").textContent).toContain("NETWORK down");
    expect(
      document
        .querySelector(".ga-panel-output-actions")
        .classList.contains("ga-panel-output-actions-on"),
    ).toBe(false);
  });

  it("closing the panel mid-stream aborts (not stops) the ask", async () => {
    const GA = makeGA();
    await selectAndAsk(GA);
    const handle = GA.askFlow.lastHandle;
    GA.panel.close();
    expect(handle.abort).toHaveBeenCalled();
    expect(handle.stop).not.toHaveBeenCalled();
  });

  it("Download as md wraps the output in the provenance header", async () => {
    const GA = makeGA();
    const downloads = stubGlobalDownloads();
    await selectAndAsk(GA, "find patterns");
    GA.askFlow.resolve("- pattern one");
    await tick();
    document.querySelectorAll(".ga-panel-action")[1].click();
    expect(downloads.clicks).toHaveLength(1);
    expect(downloads.clicks[0].download).toMatch(/^synthesis-\d{8}\.md$/);
    const md = await downloads.lastBlob().text();
    expect(md).toContain("# Synthesis");
    expect(md).toContain("- Prompt: find patterns");
    expect(md.endsWith("- pattern one")).toBe(true);
  });

  it("Start a conversation copies the output and opens the provider's new-chat page", async () => {
    const GA = makeGA();
    await selectAndAsk(GA);
    GA.askFlow.resolve("the synthesis");
    await tick();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    document.querySelectorAll(".ga-panel-action")[0].click();
    await tick();
    expect(writeText).toHaveBeenCalledWith("the synthesis");
    expect(opened).toHaveBeenCalledWith("https://gemini.google.com/app", "_blank");
    expect(document.querySelector(".ga-toast").textContent).toContain("paste into the new chat");
  });
});
