// calm-scroll.js — auto-scroll policy for a streaming answer, shared by the
// docked box, the modal, and the synthesis panel. Two modes, chosen live by
// the "calm scrolling" setting:
//
//   off (default): stick-follow — the view tracks the stream only while the
//     user is at the bottom; scrolling up to re-read is never yanked back.
//   on: after an answer starts, the view follows only the first few lines
//     (CALM_SCROLL_BUDGET_PX) and then holds still while tokens keep landing
//     below the fold. A circled scroll-down button (sticky inside the scroll
//     area) marks the unseen content; clicking it — or scrolling to the
//     bottom yourself — jumps to the newest text and resumes following.
//
// GA.CalmScroll(container) -> { toBottom(), follow(), answerStart(),
//                               answerEnd() }
//   toBottom()    — unconditional jump (your own message, initial render)
//   follow()      — a stream/render update landed; scroll per the policy
//   answerStart() — a model answer begins: arm the calm budget
//   answerEnd()   — the answer settled (error included): disarm it
var GA = (typeof GA !== "undefined" && GA) || {};

GA.CalmScroll = function (container) {
  const SLACK_PX = 32; // "at the bottom" tolerance, same feel as the box's stick

  let stick = true; // user is at/near the bottom
  let budget = null; // max scrollTop calm mode allows for this answer
  let resumed = false; // user opted back into following mid-answer

  const btn = GA.el(
    "button",
    {
      class: "ga-iconbtn ga-scrolldown",
      title: "Scroll to the newest text",
      "aria-label": "Scroll to the newest text",
      onclick: function (e) {
        e.stopPropagation();
        resumed = true;
        toBottom();
      },
    },
    GA.icons.make("chevron-down"),
  );
  btn.hidden = true;
  // Sticky riding near the scrollport's bottom edge; height 0 so it takes no
  // layout space and appended messages never move it. First child, so hosts
  // that append content leave it alone — hosts that CLEAR the container are
  // healed by ensurePin below.
  const pin = GA.el("div", { class: "ga-scroll-pin" }, btn);
  container.prepend(pin);

  function ensurePin() {
    if (!pin.isConnected) container.prepend(pin);
  }

  const enabled = () => !!GA.settings.calmScroll;
  const below = () => container.scrollHeight - container.scrollTop - container.clientHeight;

  container.addEventListener("scroll", function () {
    stick = below() < SLACK_PX;
    // Scrolling to the bottom yourself during a held answer means "follow".
    if (stick && budget != null) resumed = true;
    updateArrow();
  });

  function updateArrow() {
    ensurePin();
    btn.hidden = !(enabled() && below() >= SLACK_PX);
  }

  function toBottom() {
    ensurePin();
    container.scrollTop = container.scrollHeight;
    stick = true;
    updateArrow();
  }

  function follow() {
    if (enabled() && budget != null && !resumed) {
      // Calm hold: allow growth up to the budget, then stand still.
      const max = container.scrollHeight - container.clientHeight;
      const target = Math.min(budget, max);
      if (container.scrollTop < target) container.scrollTop = target;
    } else if (stick) {
      container.scrollTop = container.scrollHeight;
    }
    updateArrow();
  }

  function answerStart() {
    budget = container.scrollTop + GA.config.CALM_SCROLL_BUDGET_PX;
    resumed = false;
  }

  function answerEnd() {
    budget = null;
    resumed = false;
    updateArrow();
  }

  return { toBottom, follow, answerStart, answerEnd };
};
