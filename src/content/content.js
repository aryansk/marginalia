// content.js — controller. Wires triggers, thread lifecycle, the Gemini request
// round-trip (via the background port), token bridging, persistence, SPA-nav
// handling, and re-anchoring after Gemini re-renders.
var GA = GA || {};

(function () {
  const threadsById = new Map();
  let currentSession = null;
  let cachedTokens = null;
  let domObserver = null;

  function sessionKey() {
    return currentSession; // null -> store uses the draft bucket
  }

  // ---------- thread lifecycle ----------

  function makeHandlers(thread) {
    return {
      ask: (t, opts) => ask(t, opts),
      persist: (t) => GA.store.upsert(sessionKey(), t),
      onDelete: (t) => deleteThread(t),
      onFocus: (t) => GA.gutter.setActive(t.id),
      onExpand: (t) => GA.Modal.open(t),
      onResize: () => GA.gutter.scheduleLayout(),
    };
  }

  function addThread(thread) {
    const box = GA.ThreadBox(thread, makeHandlers(thread));
    threadsById.set(thread.id, thread);
    GA.gutter.add(thread.id, box);
    return box;
  }

  async function createThreadFromSelection() {
    const cap = GA.selection.capture();
    if (!cap) {
      GA.toast("Select some text in an answer first.");
      return;
    }
    const thread = {
      id: GA.uid("t"),
      selector: cap.selector,
      section: GA.truncate(cap.sectionText, 4000),
      messages: [],
      createdAt: Date.now(),
    };
    GA.selection.highlightRange(cap.range, thread.id);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    const box = addThread(thread);
    await GA.store.upsert(sessionKey(), thread);
    GA.gutter.relayout();
    GA.gutter.setActive(thread.id);
    box.focusInput();
  }

  function restoreThread(thread) {
    GA.selection.highlightSelector(thread.selector, thread.id); // empty -> orphan
    addThread(thread);
  }

  function deleteThread(thread) {
    GA.selection.unhighlight(thread.id);
    GA.gutter.remove(thread.id);
    threadsById.delete(thread.id);
    GA.store.remove(sessionKey(), thread.id);
  }

  function teardownAll() {
    GA.Modal.close();
    threadsById.forEach((t) => GA.selection.unhighlight(t.id));
    GA.gutter.clear();
    threadsById.clear();
  }

  async function restoreForSession(session) {
    currentSession = session;
    await GA.store.migrateDraft(session);
    const threads = await GA.store.load(session);
    threads.forEach(restoreThread);
    GA.gutter.relayout();
    // Gemini hydrates async — retry anchoring a few times.
    [400, 1000, 2200].forEach((d) => setTimeout(reanchorOrphans, d));
  }

  // Re-find highlights for threads whose anchor span is missing (after re-render).
  function reanchorOrphans() {
    let changed = false;
    threadsById.forEach((thread) => {
      if (!GA.selection.anchorEl(thread.id)) {
        const spans = GA.selection.highlightSelector(thread.selector, thread.id);
        if (spans && spans.length) changed = true;
      }
    });
    GA.gutter.scheduleLayout();
    return changed;
  }

  // ---------- asking Gemini (content -> background -> Gemini) ----------

  function composePrompt(thread) {
    const scope = GA.settings.scope;
    let context;
    if (scope === "selection") context = thread.selector.exact;
    else if (scope === "conversation") context = conversationText();
    else context = thread.section || thread.selector.exact;

    const lines = [];
    lines.push("I'm reading an answer you (Gemini) gave me. Relevant context:");
    lines.push('"""');
    lines.push(context);
    lines.push('"""');
    lines.push("");
    lines.push('I highlighted this specific part: "' + thread.selector.exact + '"');
    lines.push("");
    lines.push("Our follow-up discussion so far:");
    (thread.messages || []).forEach((m) => {
      lines.push((m.role === "user" ? "Me: " : "You: ") + m.text);
    });
    lines.push("");
    lines.push(
      "Answer my latest question concisely, focused only on the highlighted part. " +
        "Don't repeat the whole original explanation."
    );
    return lines.join("\n");
  }

  function conversationText() {
    const parts = [];
    GA.selection.findAllSections().forEach((s) => {
      const t = (s.innerText || s.textContent || "").trim();
      if (t) parts.push(t);
    });
    return GA.truncate(parts.join("\n\n"), 12000);
  }

  function ask(thread, opts) {
    const onChunk = opts && opts.onChunk;
    return new Promise(function (resolve, reject) {
      getTokens()
        .then(function (tokens) {
          const port = browser.runtime.connect({ name: "ga-ask" });
          let finalText = "";
          let settled = false;
          port.onMessage.addListener(function (msg) {
            if (!msg) return;
            if (msg.type === "chunk") {
              finalText = msg.text;
              onChunk && onChunk(msg.text);
            } else if (msg.type === "done") {
              settled = true;
              resolve(msg.text || finalText);
              port.disconnect();
            } else if (msg.type === "error") {
              settled = true;
              reject(new Error(msg.message || "Request failed"));
              port.disconnect();
            }
          });
          port.onDisconnect.addListener(function () {
            if (!settled) reject(new Error("Connection to extension closed."));
          });
          port.postMessage({ type: "ask", prompt: composePrompt(thread), tokens });
        })
        .catch(reject);
    });
  }

  // ---------- session tokens ----------
  // Primary: scrape the tokens from inline bootstrap scripts (CSP-safe, runs in
  // our isolated world). Fallback: ask the background to read window.WIZ_global_data
  // from the MAIN world via scripting.executeScript.

  // Match "key":"string" or "key":number (FdrFje/f.sid is sometimes unquoted).
  function grab(txt, key) {
    let m = txt.match(new RegExp('"' + key + '":"([^"]*)"'));
    if (m) return m[1];
    m = txt.match(new RegExp('"' + key + '":(-?\\d+)'));
    return m ? m[1] : null;
  }

  function scrapeTokens() {
    let at = null,
      bl = null,
      sid = null;
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const txt = s.textContent;
      if (!txt) continue;
      if (!at) at = grab(txt, "SNlM0e");
      if (!bl) bl = grab(txt, "cfb2h");
      if (!sid) sid = grab(txt, "FdrFje");
      if (at && bl && sid) break;
    }
    return { at, bl, sid };
  }

  async function getTokens() {
    if (cachedTokens && cachedTokens.at && Date.now() - cachedTokens.ts < 60000)
      return cachedTokens;
    let t = scrapeTokens();
    if (!t.at || !t.bl || !t.sid) {
      const f =
        (await browser.runtime.sendMessage({ type: "ga-read-tokens" }).catch(() => null)) || {};
      t = { at: t.at || f.at, bl: t.bl || f.bl, sid: t.sid || f.sid };
    }
    if (!t.at)
      throw new Error("Couldn't read your Gemini session token. Are you logged in?");
    cachedTokens = { at: t.at, bl: t.bl, sid: t.sid, ts: Date.now() };
    return cachedTokens;
  }

  // ---------- triggers ----------

  function setupTriggers() {
    // context menu (from background)
    browser.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "ga-open-from-context") createThreadFromSelection();
    });
    // configurable keyboard shortcut
    document.addEventListener(
      "keydown",
      function (e) {
        const sc = GA.settings.shortcut || {};
        if (
          e.key &&
          e.key.toLowerCase() === sc.key &&
          !!e.ctrlKey === !!sc.ctrl &&
          !!e.shiftKey === !!sc.shift &&
          !!e.altKey === !!sc.alt &&
          !!e.metaKey === !!sc.meta
        ) {
          const txt = String(window.getSelection() || "").trim();
          if (txt) {
            e.preventDefault();
            createThreadFromSelection();
          }
        }
      },
      true
    );
  }

  // ---------- global UI listeners ----------

  function setupGlobalListeners() {
    document.addEventListener("mousedown", function (e) {
      const t = e.target;
      if (t.closest && (t.closest(".ga-box") || t.closest(".ga-modal"))) return;
      const hl = t.closest && t.closest("span.ga-highlight");
      if (hl && hl.dataset.gaThread) {
        GA.gutter.setActive(hl.dataset.gaThread);
        return;
      }
      GA.gutter.setActive(null);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") GA.gutter.setActive(null);
    });
  }

  // ---------- SPA navigation ----------

  function setupNavWatch() {
    const fire = () => onRouteChange();
    ["pushState", "replaceState"].forEach(function (m) {
      const orig = history[m];
      history[m] = function () {
        const r = orig.apply(this, arguments);
        window.dispatchEvent(new Event("ga:locationchange"));
        return r;
      };
    });
    window.addEventListener("popstate", fire);
    window.addEventListener("ga:locationchange", fire);
    let last = location.href;
    setInterval(function () {
      if (location.href !== last) {
        last = location.href;
        fire();
      }
    }, 1000);
  }

  async function onRouteChange() {
    const next = GA.getSessionId();
    if (next === currentSession) return;
    teardownAll();
    await restoreForSession(next);
  }

  // ---------- DOM observer (re-anchor + relayout after Gemini re-renders) ----------

  function observeDom() {
    let pending = false;
    domObserver = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        reanchorOrphans();
        GA.gutter.scheduleLayout();
      });
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- init ----------

  (async function init() {
    await GA.loadSettings();
    browser.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[GA.SETTINGS_KEY]) GA.loadSettings();
    });
    GA.gutter.init();
    setupTriggers();
    setupGlobalListeners();
    setupNavWatch();
    observeDom();
    await restoreForSession(GA.getSessionId());
    GA.log("ready; session =", currentSession);
  })();
})();
