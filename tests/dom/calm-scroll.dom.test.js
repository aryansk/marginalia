// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

// GA.CalmScroll: stick-follow when the setting is off, the budgeted hold +
// scroll-down button when it's on. jsdom has no layout, so scroll geometry
// (scrollHeight/clientHeight) is stubbed per test; scrollTop stores values.

function makeGA() {
  return loadGA([
    "src/shared/settings-schema.js",
    "src/shared/config.js",
    "src/core/sites.js",
    "src/content/util.js",
    "src/content/icons.js",
    "src/content/calm-scroll.js",
  ]);
}

afterEach(() => {
  document.body.innerHTML = "";
});

// A 200px-tall viewport over `content` px of content. scrollTop clamps to
// [0, scrollHeight - clientHeight] like a real browser (jsdom doesn't).
function makeContainer(content) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  Object.defineProperty(el, "clientHeight", { value: 200, configurable: true });
  let h = content;
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { get: () => h, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v) => {
      top = Math.max(0, Math.min(v, h - 200));
    },
    configurable: true,
  });
  el.grow = (px) => (h += px);
  return el;
}

const scrollTo = (el, top) => {
  el.scrollTop = top;
  el.dispatchEvent(new window.Event("scroll"));
};

describe("calm scrolling off (default): stick-follow", () => {
  it("follows the stream while at the bottom; scrolling up disengages", () => {
    const GA = makeGA();
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);

    calm.toBottom();
    expect(el.scrollTop).toBe(200); // 400 content - 200 viewport

    el.grow(100);
    calm.follow();
    expect(el.scrollTop).toBe(300); // stuck to the bottom

    scrollTo(el, 100); // user scrolls up to re-read
    el.grow(100);
    calm.follow();
    expect(el.scrollTop).toBe(100); // never yanked back down
  });

  it("the scroll-down button stays hidden", () => {
    const GA = makeGA();
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);
    scrollTo(el, 0); // plenty of content below
    calm.follow();
    expect(el.querySelector(".ga-scrolldown").hidden).toBe(true);
  });
});

describe("calm scrolling on: budgeted hold + scroll-down button", () => {
  it("follows only CALM_SCROLL_BUDGET_PX past the answer start, then holds", () => {
    const GA = makeGA();
    GA.settings.calmScroll = true;
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);

    calm.toBottom(); // the user's question scrolled into view
    const start = el.scrollTop; // 200 (400 - 200 viewport)
    calm.answerStart();

    el.grow(30); // a line and a half arrives
    calm.follow();
    expect(el.scrollTop).toBe(start + 30); // still following

    el.grow(500); // the stream races ahead
    calm.follow();
    expect(el.scrollTop).toBe(start + GA.config.CALM_SCROLL_BUDGET_PX); // held

    el.grow(500);
    calm.follow();
    expect(el.scrollTop).toBe(start + GA.config.CALM_SCROLL_BUDGET_PX); // still held
  });

  it("shows the button while content grows below; clicking jumps + resumes following", () => {
    const GA = makeGA();
    GA.settings.calmScroll = true;
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);
    const btn = el.querySelector(".ga-scrolldown");

    calm.toBottom();
    expect(btn.hidden).toBe(true); // nothing unseen

    calm.answerStart();
    el.grow(500);
    calm.follow();
    expect(btn.hidden).toBe(false); // held with content below

    btn.click();
    expect(el.scrollTop).toBe(900 - 200); // jumped to the newest text
    expect(btn.hidden).toBe(true);

    el.grow(100);
    calm.follow();
    expect(el.scrollTop).toBe(1000 - 200); // resumed following
  });

  it("scrolling to the bottom yourself mid-answer also resumes following", () => {
    const GA = makeGA();
    GA.settings.calmScroll = true;
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);

    calm.toBottom();
    calm.answerStart();
    el.grow(500);
    calm.follow(); // held

    scrollTo(el, el.scrollHeight - 200); // user reads down to the bottom
    el.grow(100);
    calm.follow();
    expect(el.scrollTop).toBe(el.scrollHeight - 200); // following again
  });

  it("answerEnd disarms the hold — the next render follows the stick rule again", () => {
    const GA = makeGA();
    GA.settings.calmScroll = true;
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);

    calm.toBottom();
    calm.answerStart();
    el.grow(500);
    calm.follow(); // held mid-answer
    calm.answerEnd();

    scrollTo(el, el.scrollHeight - 200); // back at the bottom (stick)
    el.grow(50);
    calm.follow();
    expect(el.scrollTop).toBe(el.scrollHeight - 200); // plain stick-follow
  });

  it("the pin heals after the host clears the container (refreshMessages)", () => {
    const GA = makeGA();
    GA.settings.calmScroll = true;
    const el = makeContainer(400);
    const calm = GA.CalmScroll(el);

    el.textContent = ""; // host rebuild wipes children, pin included
    expect(el.querySelector(".ga-scroll-pin")).toBeFalsy();
    calm.follow();
    expect(el.firstChild.classList.contains("ga-scroll-pin")).toBe(true);
  });
});
