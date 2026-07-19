import { describe, it, expect } from "vitest";
import liveStream from "../../src/core/live-stream.js";

const { makeRegistry } = liveStream;

describe("live-stream registry", () => {
  it("get returns null for an unknown id", () => {
    expect(makeRegistry().get("t1")).toBeNull();
  });

  it("push updates text and notifies subscribers with done=false", () => {
    const reg = makeRegistry();
    const feed = reg.begin("t1");
    const seen = [];
    feed.subscribe((text, done) => seen.push([text, done]));
    feed.push("Hel");
    feed.push("Hello");
    expect(feed.text).toBe("Hello");
    expect(seen).toEqual([
      ["Hel", false],
      ["Hello", false],
    ]);
  });

  it("a late joiner reads the accumulated text before subscribing", () => {
    const reg = makeRegistry();
    reg.begin("t1").push("partial answer");
    const feed = reg.get("t1");
    expect(feed.text).toBe("partial answer");
  });

  it("end notifies done=true with the final text and removes the feed", () => {
    const reg = makeRegistry();
    const feed = reg.begin("t1");
    const seen = [];
    feed.subscribe((text, done) => seen.push([text, done]));
    feed.push("full");
    reg.end("t1");
    expect(seen[seen.length - 1]).toEqual(["full", true]);
    expect(reg.get("t1")).toBeNull();
    reg.end("t1"); // idempotent
  });

  it("unsubscribe stops delivery", () => {
    const reg = makeRegistry();
    const feed = reg.begin("t1");
    const seen = [];
    const fn = (text) => seen.push(text);
    feed.subscribe(fn);
    feed.push("a");
    feed.unsubscribe(fn);
    feed.push("ab");
    reg.end("t1");
    expect(seen).toEqual(["a"]);
  });

  it("begin on a live id finishes the stale feed first (re-ask replaces)", () => {
    const reg = makeRegistry();
    const old = reg.begin("t1");
    const seen = [];
    old.subscribe((text, done) => seen.push(done));
    const fresh = reg.begin("t1");
    expect(seen).toEqual([true]); // old feed observers saw done
    expect(reg.get("t1")).toBe(fresh);
  });

  it("a throwing listener cannot break delivery to others", () => {
    const reg = makeRegistry();
    const feed = reg.begin("t1");
    const seen = [];
    feed.subscribe(() => {
      throw new Error("boom");
    });
    feed.subscribe((text) => seen.push(text));
    feed.push("ok");
    expect(seen).toEqual(["ok"]);
  });

  it("feeds are independent per id", () => {
    const reg = makeRegistry();
    const a = reg.begin("a");
    const b = reg.begin("b");
    a.push("A");
    b.push("B");
    expect(reg.get("a").text).toBe("A");
    expect(reg.get("b").text).toBe("B");
    reg.end("a");
    expect(reg.get("a")).toBeNull();
    expect(reg.get("b")).toBe(b);
  });
});
