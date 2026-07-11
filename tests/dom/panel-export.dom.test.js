// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// Export button (T-012): the panel header gains an "Export for NotebookLM"
// button — the system's SOLE decompress site. Clicking it loads the RAW convo
// record, inflates each turn's blob by its "<hash>:<len>" key (self-healing
// corrupt entries, fix F5), renders Markdown via GA.core.transcript.build, and
// delivers it as a blob: download plus a best-effort clipboard copy.
// Drives the real panel.js + compress.js + transcript.js; storage is stubbed.

function fakeBrowser() {
  return { runtime: { sendMessage: () => Promise.resolve() } };
}

function makeGA({ session = "gemini:abc", record = null, threads = [] } = {}) {
  const GA = loadGA(
    [
      "src/shared/protocol.js",
      "src/shared/settings-schema.js",
      "src/shared/config.js",
      "src/core/sites.js",
      "src/core/markdown-ast.js",
      "src/core/thread-search.js",
      "src/core/turn-id.js",
      "src/core/compress.js",
      "src/core/transcript.js",
      "src/content/util.js",
      "src/content/icons.js",
      "src/content/panel.js",
    ],
    { browser: fakeBrowser() }
  );
  GA.threadController = { threads: () => threads, expandThreadById: () => {} };
  GA.selection = { anchorEl: () => null };
  GA.gutter = { get: () => null, setActive: () => {}, mode: () => "normal" };
  GA.getSessionId = () => session;
  GA.warn = vi.fn();
  GA.store = {
    loadConvo: vi.fn(async () => record),
    saveConvo: vi.fn(async () => {}),
  };
  return GA;
}

// A convo record exactly as capture (T-010) stores it: plaintext turn index +
// per-message gzip blobs keyed by BOTH fingerprint parts.
async function makeRecord(GA, msgs, extra = {}) {
  const turns = [];
  const blobs = {};
  for (let i = 0; i < msgs.length; i++) {
    const fp = GA.core.turnId.fingerprint(msgs[i].text);
    turns.push({ role: msgs[i].role, fp, order: i });
    blobs[fp.hash + ":" + fp.len] = await GA.core.compress.gzipToB64(msgs[i].text);
  }
  return Object.assign(
    {
      provider: "gemini",
      id: "abc",
      title: "My Chat",
      url: "https://gemini.google.com/app/abc",
      capturedAt: 1700000000000,
      turns,
      blobs,
    },
    extra
  );
}

function exportBtn() {
  return document.querySelector(
    '.ga-modal-header .ga-iconbtn[aria-label="Export conversation for NotebookLM"]'
  );
}
function header() {
  return document.querySelector(".ga-modal-header");
}
function toastText() {
  const t = document.querySelector(".ga-toast");
  return t ? t.textContent : "";
}
function todayYMD() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

let clicks; // [{download, href}] per stubbed anchor click
let clipboardWrites;
let clipboardReject;

beforeEach(() => {
  document.body.innerHTML = "";
  clicks = [];
  clipboardWrites = [];
  clipboardReject = false;
  URL.createObjectURL = vi.fn((blob) => {
    URL.createObjectURL.lastBlob = blob;
    return "blob:vitest";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicks.push({ download: this.getAttribute("download"), href: this.getAttribute("href") });
  });
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (s) => {
        if (clipboardReject) throw new Error("clipboard denied");
        clipboardWrites.push(s);
      }),
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.navigator.clipboard;
  document.body.innerHTML = "";
});

async function clickExport(GA) {
  GA.panel.open();
  exportBtn().click();
  await vi.waitFor(() => {
    if (!toastText()) throw new Error("no toast yet");
  });
}

describe("panel export button (T-012)", () => {
  it("renders in the coordinated header order; closeBtn stays last and focused", async () => {
    makeGA({ record: await makeRecord(makeGA(), []) }).panel.open();
    const kids = Array.from(header().children);
    const last = kids[kids.length - 1];
    expect(last.getAttribute("aria-label")).toBe("Close");
    expect(kids[kids.length - 2].getAttribute("aria-label")).toBe("Settings");
    expect(kids[kids.length - 3]).toBe(exportBtn());
    expect(exportBtn().querySelector("svg")).not.toBeNull();
    expect(document.activeElement).toBe(last);
  });

  it("GA.icons.make('download') renders a 3-path glyph", () => {
    const svg = makeGA().icons.make("download");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll("path").length).toBe(3);
  });

  it("click: loads the RAW record, decompresses each blob by its hash:len key, builds md, downloads", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [
      { role: "user", text: "What is a monad?" },
      { role: "model", text: "A monoid in the category of endofunctors." },
    ]);
    const threads = [
      {
        id: "t1",
        selector: { exact: "monoid in the category" },
        messages: [{ role: "user", text: "explain simpler" }],
        createdAt: 1,
        anchor: { turn: record.turns[1].fp },
      },
    ];
    GA = makeGA({ record, threads });
    const buildSpy = vi.spyOn(GA.core.transcript, "build");
    await clickExport(GA);

    expect(GA.store.loadConvo).toHaveBeenCalledWith("gemini:abc");
    // decoded record handed to the builder: same turns, text DECOMPRESSED
    const [decoded, passedThreads] = buildSpy.mock.calls[0];
    expect(decoded.title).toBe("My Chat");
    expect(decoded.turns.map((t) => t.text)).toEqual([
      "What is a monad?",
      "A monoid in the category of endofunctors.",
    ]);
    expect(decoded.turns[0].fp).toEqual(record.turns[0].fp);
    expect(passedThreads).toBe(threads);
    // delivery: one anchor click with the sanitized dated filename + revoke
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual([{ download: "My-Chat-" + todayYMD() + ".md", href: "blob:vitest" }]);
    // revoke is deferred one macrotask — same-tick revocation after click()
    // is the pattern that aborted downloads in old Firefox
    await vi.waitFor(() => {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:vitest");
    });
    // the downloaded bytes are the built markdown — transcript + annotation
    const md = await URL.createObjectURL.lastBlob.text();
    expect(md).toBe(buildSpy.mock.results[0].value);
    expect(md).toContain("# My Chat");
    expect(md).toContain("## You");
    expect(md).toContain("What is a monad?");
    expect(md).toContain("A monoid in the category of endofunctors.");
    expect(md).toContain("explain simpler");
    expect(toastText()).toBe("Transcript downloaded and copied to clipboard.");
    // clean export: nothing corrupt, so no self-heal write
    expect(GA.store.saveConvo).not.toHaveBeenCalled();
  });

  it("copies the same md to the clipboard, best-effort", async () => {
    let GA = makeGA();
    GA = makeGA({ record: await makeRecord(GA, [{ role: "user", text: "hi" }]) });
    await clickExport(GA);
    expect(clipboardWrites).toHaveLength(1);
    expect(clipboardWrites[0]).toContain("hi");
    const md = await URL.createObjectURL.lastBlob.text();
    expect(clipboardWrites[0]).toBe(md);
  });

  it("a rejecting clipboard leaves the download succeeded", async () => {
    clipboardReject = true;
    let GA = makeGA();
    GA = makeGA({ record: await makeRecord(GA, [{ role: "user", text: "hi" }]) });
    await clickExport(GA);
    expect(clicks).toHaveLength(1);
    expect(toastText()).toBe("Transcript downloaded.");
    expect(document.querySelector(".ga-modal-overlay")).not.toBeNull(); // panel stays open
  });

  it("null session: friendly message, no storage read, no download", async () => {
    const GA = makeGA({ session: null });
    await clickExport(GA);
    expect(GA.store.loadConvo).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(toastText()).toMatch(/No transcript captured yet/);
  });

  it("no stored record, and a record with empty turns: friendly message, no download", async () => {
    const GA = makeGA({ record: null });
    await clickExport(GA);
    expect(clicks).toHaveLength(0);
    expect(toastText()).toMatch(/No transcript captured yet/);

    document.body.innerHTML = "";
    let GA2 = makeGA();
    GA2 = makeGA({ record: await makeRecord(GA2, []) });
    await clickExport(GA2);
    expect(clicks).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(toastText()).toMatch(/No transcript captured yet/);
  });

  it("a turn whose key has no blob exports as empty text — download still produced, no heal", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [
      { role: "user", text: "kept question" },
      { role: "model", text: "vanished answer" },
    ]);
    delete record.blobs[record.turns[1].fp.hash + ":" + record.turns[1].fp.len];
    GA = makeGA({ record });
    await clickExport(GA);
    expect(clicks).toHaveLength(1);
    const md = await URL.createObjectURL.lastBlob.text();
    expect(md).toContain("kept question");
    expect(md).not.toContain("vanished answer");
    expect(md).toContain("## Assistant"); // heading survives with empty body
    // missing is not corrupt: nothing to heal, no write
    expect(GA.store.saveConvo).not.toHaveBeenCalled();
  });

  it("F5 self-heal: a corrupt blob renders empty AND its entry is deleted + saved", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [
      { role: "user", text: "good turn" },
      { role: "model", text: "rotten turn" },
    ]);
    const goodKey = record.turns[0].fp.hash + ":" + record.turns[0].fp.len;
    const badKey = record.turns[1].fp.hash + ":" + record.turns[1].fp.len;
    record.blobs[badKey] = "AAAA"; // valid base64, not gzip — b64ToText rejects
    GA = makeGA({ record });
    await clickExport(GA);
    // export still succeeds, corrupt turn empty
    expect(clicks).toHaveLength(1);
    const md = await URL.createObjectURL.lastBlob.text();
    expect(md).toContain("good turn");
    expect(md).not.toContain("rotten turn");
    // heal: the corrupt entry is gone, the good one kept, record saved back
    expect(GA.store.saveConvo).toHaveBeenCalledTimes(1);
    const [healSession, healed] = GA.store.saveConvo.mock.calls[0];
    expect(healSession).toBe("gemini:abc");
    expect(healed.blobs[badKey]).toBeUndefined();
    expect(healed.blobs[goodKey]).toBeDefined();
    expect(healed.turns).toHaveLength(2); // index untouched — capture refills the blob
  });

  it("self-heal writes the FRESHLY re-loaded record, not the stale pre-decompress snapshot", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [{ role: "model", text: "rotten" }]);
    const badKey = record.turns[0].fp.hash + ":" + record.turns[0].fp.len;
    record.blobs[badKey] = "AAAA";
    // a concurrent capture re-wrote the record while the export decompressed:
    // same corrupt entry, plus a freshly banked blob the stale snapshot lacks
    const fresh = JSON.parse(JSON.stringify(record));
    fresh.blobs["123:9"] = "freshly-banked";
    fresh.turns.push({ role: "user", fp: { hash: 123, len: 9 }, order: 1 });
    GA = makeGA({ record });
    GA.store.loadConvo = vi.fn(async function () {
      return GA.store.loadConvo.mock.calls.length > 1 ? fresh : record;
    });
    await clickExport(GA);
    expect(GA.store.loadConvo).toHaveBeenCalledTimes(2);
    const [, healed] = GA.store.saveConvo.mock.calls[0];
    expect(healed).toBe(fresh); // the re-loaded record is what gets written
    expect(healed.blobs[badKey]).toBeUndefined();
    expect(healed.blobs["123:9"]).toBe("freshly-banked"); // banked data survives the heal
    expect(healed.turns).toHaveLength(2);
  });

  it("self-heal skips the write when the record vanished mid-export", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [{ role: "model", text: "rotten" }]);
    record.blobs[record.turns[0].fp.hash + ":" + record.turns[0].fp.len] = "AAAA";
    GA = makeGA({ record });
    GA.store.loadConvo = vi.fn(async function () {
      return GA.store.loadConvo.mock.calls.length > 1 ? null : record;
    });
    await clickExport(GA);
    // never resurrect the stale snapshot over a deleted record
    expect(GA.store.saveConvo).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1); // the export itself still delivers
    expect(toastText()).toMatch(/Transcript downloaded/);
  });

  it("a failing self-heal save does not block the export", async () => {
    let GA = makeGA();
    const record = await makeRecord(GA, [{ role: "model", text: "rotten" }]);
    record.blobs[record.turns[0].fp.hash + ":" + record.turns[0].fp.len] = "AAAA";
    GA = makeGA({ record });
    GA.store.saveConvo = vi.fn(async () => {
      throw new Error("quota");
    });
    await clickExport(GA);
    expect(GA.store.saveConvo).toHaveBeenCalledTimes(1);
    expect(clicks).toHaveLength(1);
    expect(toastText()).toMatch(/Transcript downloaded/);
  });

  it("XSS: malicious title and thread text never become DOM; filename is sanitized", async () => {
    let GA = makeGA();
    const record = await makeRecord(
      GA,
      [{ role: "model", text: '<img src=x onerror=alert(1)> and <b>bold</b>' }],
      { title: '<img src=x onerror=alert(1)>../../evil "name"' }
    );
    const threads = [
      {
        id: "t1",
        selector: { exact: "<b>boom</b>" },
        messages: [{ role: "user", text: "<img src=y>" }],
        createdAt: 1,
        anchor: null,
      },
    ];
    GA = makeGA({ record, threads });
    await clickExport(GA);
    expect(clicks).toHaveLength(1);
    expect(document.querySelector("img, b")).toBeNull();
    expect(clicks[0].download).toMatch(/^[\w-]+-\d{8}\.md$/);
    expect(clicks[0].download).not.toMatch(/[<>"/\\.]{2}/);
    const md = await URL.createObjectURL.lastBlob.text();
    expect(md).toContain("\\<img"); // escaped by the builder, never markup
  });

  it("a throwing storage load surfaces the failure toast instead of a silent rejection", async () => {
    const GA = makeGA();
    GA.store.loadConvo = vi.fn(async () => {
      throw new Error("storage gone");
    });
    await clickExport(GA);
    expect(clicks).toHaveLength(0);
    expect(toastText()).toMatch(/Export failed/);
  });
});
