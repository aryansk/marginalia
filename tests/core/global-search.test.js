import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/core/thread-search.js", "src/core/labels.js", "src/core/global-search.js"]);
const { searchThreads, collectLabels, filterByLabels } = GA.core.globalSearch;

const thread = (id, exact, opts = {}) => ({
  id,
  selector: { exact },
  messages: opts.messages || [],
  labels: opts.labels,
  kind: opts.kind,
});

const buckets = [
  {
    session: "gemini:abc",
    threads: [
      thread("t1", "Higgs boson decay", {
        messages: [{ role: "user", text: "why so fast?" }],
        labels: ["physics.particles"],
      }),
      thread("l1", "the anchored turn", { kind: "label", labels: ["physics.particles", "todo"] }),
    ],
  },
  {
    session: "chatgpt:xyz",
    threads: [
      thread("t2", "CSS anchor positioning", { labels: ["project.ux"] }),
      thread("t3", "unlabeled thread"),
    ],
  },
];

describe("GA.core.globalSearch.searchThreads", () => {
  it("searches every bucket, tagging hits with their session", () => {
    expect(searchThreads(buckets, "anchor")).toEqual([
      { session: "chatgpt:xyz", record: buckets[1].threads[0] },
    ]);
    expect(searchThreads(buckets, "why so fast")).toEqual([
      { session: "gemini:abc", record: buckets[0].threads[0] },
    ]);
  });

  it("excludes standalone label records even on a text match", () => {
    expect(searchThreads(buckets, "anchored turn")).toEqual([]);
  });

  it("empty query returns all conversation threads; null-safe on sparse input", () => {
    expect(searchThreads(buckets, "").map((r) => r.record.id)).toEqual(["t1", "t2", "t3"]);
    expect(searchThreads(null, "x")).toEqual([]);
    expect(searchThreads([{ session: "s" }, null], "")).toEqual([]);
  });
});

describe("GA.core.globalSearch.collectLabels", () => {
  it("unions labels across buckets and kinds, sorted and deduped", () => {
    expect(collectLabels(buckets)).toEqual(["physics.particles", "project.ux", "todo"]);
  });

  it("handles empty input", () => {
    expect(collectLabels([])).toEqual([]);
    expect(collectLabels(null)).toEqual([]);
  });
});

describe("GA.core.globalSearch.filterByLabels", () => {
  it("matches by namespace containment across both kinds", () => {
    expect(filterByLabels(buckets, ["physics"]).map((r) => r.record.id)).toEqual(["t1", "l1"]);
    expect(filterByLabels(buckets, ["todo"]).map((r) => r.record.id)).toEqual(["l1"]);
  });

  it("multiple selections union", () => {
    expect(filterByLabels(buckets, ["project.ux", "todo"]).map((r) => r.record.id)).toEqual([
      "l1",
      "t2",
    ]);
  });

  it("no selection selects nothing", () => {
    expect(filterByLabels(buckets, [])).toEqual([]);
    expect(filterByLabels(buckets, null)).toEqual([]);
  });
});
