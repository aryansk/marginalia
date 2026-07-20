// download-stub.js — the shared blob-download test double: a fake
// URL.createObjectURL/revokeObjectURL registry plus an anchor-click recorder,
// in the two flavors the suites need. jsdom implements neither object URLs nor
// downloads, and a real anchor click would try to "navigate".
import { vi } from "vitest";

// Global flavor (panel-export / transcript-recovery style): patches the ambient
// URL methods with vi.fn stubs (so specs can assert call counts/args on
// URL.createObjectURL itself) and spies HTMLAnchorElement.prototype.click,
// recording {download, href} per click instead of navigating. Call from
// beforeEach; the caller's afterEach vi.restoreAllMocks() undoes the spy.
// Returns { created, revoked, clicks, lastBlob } — lastBlob() is the most
// recently created Blob (also exposed as URL.createObjectURL.lastBlob).
export function stubGlobalDownloads() {
  const created = [];
  const revoked = [];
  const clicks = [];
  URL.createObjectURL = vi.fn((blob) => {
    created.push(blob);
    URL.createObjectURL.lastBlob = blob;
    return "blob:vitest";
  });
  URL.revokeObjectURL = vi.fn((u) => {
    revoked.push(u);
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicks.push({ download: this.getAttribute("download"), href: this.getAttribute("href") });
  });
  return { created, revoked, clicks, lastBlob: () => URL.createObjectURL.lastBlob };
}

// Injected flavor (options-page style): production code receives `fakeURL` as
// its URL global via loadGA, and a capture-phase document click listener
// records + cancels download-anchor clicks (the anchor is real and the click
// bubbles, so jsdom would otherwise attempt navigation). Object URLs are
// numbered "blob:fake-1", "blob:fake-2", … in creation order.
// Returns { fakeURL, created, revoked, anchorClicks }.
export function makeInjectedDownloadStub() {
  const created = [];
  const revoked = [];
  const anchorClicks = [];
  const fakeURL = {
    createObjectURL(blob) {
      created.push(blob);
      return "blob:fake-" + created.length;
    },
    revokeObjectURL(u) {
      revoked.push(u);
    },
  };
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.tagName === "A") {
        anchorClicks.push({ download: e.target.download, href: e.target.href });
        e.preventDefault();
      }
    },
    true,
  );
  return { fakeURL, created, revoked, anchorClicks };
}
