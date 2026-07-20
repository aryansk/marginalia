// live-stream.js — pure: a registry of in-flight answer streams, keyed by
// thread id, so a second surface can late-join one that is already streaming
// (the modal opening while the docked box's ask is mid-answer). The owner of
// the ask calls begin/push/end; observers get(id) and subscribe.
//
//   const reg = makeRegistry();
//   const feed = reg.begin(id);   // owner: start (replaces a stale feed)
//   feed.push(text)               // owner: full answer-so-far -> fn(text, false)
//   reg.end(id)                   // owner: settle -> fn(text, true), removed
//   reg.get(id)                   // observer: feed | null; feed.text = so-far
//   feed.subscribe(fn) / feed.unsubscribe(fn)
//
// No DOM, no timers. Listener errors are swallowed so a broken observer can
// never break the ask loop that is feeding it.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.core = GA.core || {};

GA.core.liveStream = (function () {
  function makeRegistry() {
    const feeds = new Map();

    function makeFeed() {
      const listeners = new Set();
      const feed = {
        text: "",
        push(t) {
          feed.text = t == null ? "" : String(t);
          notify(false);
        },
        subscribe(fn) {
          listeners.add(fn);
        },
        unsubscribe(fn) {
          listeners.delete(fn);
        },
      };
      function notify(done) {
        listeners.forEach((fn) => {
          try {
            fn(feed.text, done);
          } catch (e) {
            // Policy (see header): a broken observer must never break the ask
            // loop feeding it — but a fully silent drop is undiagnosable.
            console.debug("[marginalia] live-stream listener threw", e);
          }
        });
        if (done) listeners.clear();
      }
      feed._end = () => notify(true);
      return feed;
    }

    return {
      begin(id) {
        this.end(id); // a replaced feed (same-thread re-ask) finishes first
        const feed = makeFeed();
        feeds.set(id, feed);
        return feed;
      },
      get(id) {
        return feeds.get(id) || null;
      },
      end(id) {
        const feed = feeds.get(id);
        if (!feed) return;
        feeds.delete(id);
        feed._end();
      },
    };
  }

  return { makeRegistry };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.core.liveStream;
