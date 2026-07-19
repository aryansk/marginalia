// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// First DOM coverage for GA.Modal: snapshot render, edge drag-resize with
// session memory, and late-joining a live stream (modal opened mid-answer).

function makeGA() {
  return loadGA(
    [
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/markdown-ast.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/markdown.js",
      "src/content/thread-turn.js",
      "src/content/stream-view.js",
      "src/content/dialog.js",
      "src/content/undo-stack.js",
      "src/content/composer.js",
      "src/content/modal.js",
    ],
    {
      // Deterministic sync animation frames for the streaming coalescer.
      requestAnimationFrame: (f) => (f(), 0),
      cancelAnimationFrame: () => {},
    },
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

const tick = () => new Promise((r) => setTimeout(r, 0));

const makeThread = (messages = []) => ({
  id: "t1",
  selector: { exact: "highlighted text" },
  messages,
});

const baseHandlers = () => ({ ask: vi.fn(async () => ""), persist: vi.fn() });

// A stand-in for a core/live-stream feed with inspectable listeners.
function makeFeed(text) {
  const listeners = new Set();
  return {
    text,
    listeners,
    push(t) {
      this.text = t;
      listeners.forEach((fn) => fn(t, false));
    },
    end() {
      listeners.forEach((fn) => fn(this.text, true));
      listeners.clear();
    },
    subscribe(fn) {
      listeners.add(fn);
    },
    unsubscribe(fn) {
      listeners.delete(fn);
    },
  };
}

const drag = (target, from, to) => {
  target.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: from, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: to }));
  document.dispatchEvent(new MouseEvent("mouseup", {}));
};

describe("Modal — snapshot render", () => {
  it("renders thread history and closes via onClosed", () => {
    const GA = makeGA();
    const onClosed = vi.fn();
    GA.Modal.open(
      makeThread([
        { role: "user", text: "why?" },
        { role: "model", text: "because" },
      ]),
      baseHandlers(),
      onClosed,
    );

    const msgs = document.querySelectorAll(".ga-modal-body .ga-msg");
    expect(msgs).toHaveLength(2);
    expect(msgs[1].textContent).toContain("because");

    GA.Modal.close();
    expect(document.querySelector(".ga-modal-overlay")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("Modal — drag-to-resize width", () => {
  it("right-edge drag widens by 2*dx from the 820px default and clamps to the max", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    const panel = document.querySelector(".ga-modal");
    const right = panel.querySelector(".ga-modal-resize-right");

    drag(right, 500, 550); // dx +50 -> 820 + 100
    expect(panel.style.width).toBe("920px");

    drag(right, 500, 900); // way past the edge -> clamp at 95% of 1024
    expect(panel.style.width).toBe(Math.round(1024 * 0.95) + "px");
  });

  it("left-edge drag and the min clamp; width is remembered for the session", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    let panel = document.querySelector(".ga-modal");

    drag(panel.querySelector(".ga-modal-resize-left"), 500, 900); // dx +400 leftwards -> shrink, clamp 420
    expect(panel.style.width).toBe("420px");

    GA.Modal.close();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    panel = document.querySelector(".ga-modal");
    expect(panel.style.width).toBe("420px"); // session memory

    drag(panel.querySelector(".ga-modal-resize-right"), 500, 600); // 420 + 200
    expect(panel.style.width).toBe("620px");
  });

  it("listeners detach on mouseup — further moves change nothing", () => {
    const GA = makeGA();
    GA.Modal.open(makeThread(), baseHandlers(), null);
    const panel = document.querySelector(".ga-modal");

    drag(panel.querySelector(".ga-modal-resize-right"), 500, 550);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 700 }));
    expect(panel.style.width).toBe("920px");
    expect(
      document.querySelector(".ga-modal-overlay").classList.contains("ga-modal-resizing"),
    ).toBe(false);
  });
});

describe("Modal — live stream late-join", () => {
  const openWithFeed = (GA, feed, thread) => {
    const handlers = {
      ...baseHandlers(),
      onStop: vi.fn(),
      liveStream: (id) => (id === thread.id ? feed : null),
    };
    GA.Modal.open(thread, handlers, null);
    return handlers;
  };

  it("seeds the bubble with the partial text and follows pushes", () => {
    const GA = makeGA();
    const feed = makeFeed("partial ans");
    openWithFeed(GA, feed, makeThread([{ role: "user", text: "q" }]));

    const bubble = document.querySelector(".ga-msg-streaming");
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toContain("partial ans");

    feed.push("partial answer grows");
    expect(bubble.textContent).toContain("partial answer grows");

    // composer is in Stop mode while attached
    expect(document.querySelector(".ga-input").disabled).toBe(true);
    expect(document.querySelector(".ga-send").textContent).toContain("Stop");
  });

  it("finalizes from thread.messages when the feed ends and re-enables the composer", async () => {
    const GA = makeGA();
    const feed = makeFeed("partial");
    const thread = makeThread([{ role: "user", text: "q" }]);
    openWithFeed(GA, feed, thread);

    feed.push("the full answer");
    thread.messages.push({ role: "model", text: "the full answer", ts: 1 }); // what the box's turn does
    feed.end();
    await tick();

    const bubble = document.querySelectorAll(".ga-modal-body .ga-msg")[1];
    expect(bubble.classList.contains("ga-msg-streaming")).toBe(false);
    expect(bubble.textContent).toContain("the full answer");
    expect(document.querySelector(".ga-input").disabled).toBe(false);
    expect(document.querySelector(".ga-send").textContent).toContain("Ask");
  });

  it("renders the error card when the settled message is an error", async () => {
    const GA = makeGA();
    const feed = makeFeed("");
    const thread = makeThread([{ role: "user", text: "q" }]);
    openWithFeed(GA, feed, thread);

    thread.messages.push({ role: "model", text: "Request failed.", error: true, ts: 1 });
    feed.end();
    await tick();

    expect(document.querySelector(".ga-error-card")).not.toBeNull();
    expect(document.querySelector(".ga-error-text").textContent).toBe("Request failed.");
  });

  it("closing the modal mid-stream unsubscribes from the feed", () => {
    const GA = makeGA();
    const feed = makeFeed("partial");
    openWithFeed(GA, feed, makeThread());

    expect(feed.listeners.size).toBe(1);
    GA.Modal.close();
    expect(feed.listeners.size).toBe(0);
  });
});
