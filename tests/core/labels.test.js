import { describe, it, expect } from "vitest";
import { loadGA } from "../helpers/loadGA.js";

const GA = loadGA(["src/core/labels.js"]);
const { normalize, parseList, parseCommand, merge, selects, searchMatch, groupByNamespace } =
  GA.core.labels;

describe("GA.core.labels.normalize", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalize("  Needs   Review ")).toBe("needs review");
    expect(normalize("PROJECT.UX")).toBe("project.ux");
  });

  it("trims whitespace around namespace dots", () => {
    expect(normalize("project . ux")).toBe("project.ux");
  });

  it("rejects empty and dot-malformed names", () => {
    expect(normalize("")).toBe(null);
    expect(normalize("   ")).toBe(null);
    expect(normalize(null)).toBe(null);
    expect(normalize(".ux")).toBe(null);
    expect(normalize("project.")).toBe(null);
    expect(normalize("project..ux")).toBe(null);
  });
});

describe("GA.core.labels.parseCommand", () => {
  it("returns null for non-command text (goes to the LLM)", () => {
    expect(parseCommand("why does it decay?")).toBe(null);
    expect(parseCommand("label this please")).toBe(null);
    // /labels is a different word — \b must not split it
    expect(parseCommand("/labels foo")).toBe(null);
  });

  it("parses a quoted label", () => {
    expect(parseCommand('/label "needs review"')).toEqual({ labels: ["needs review"] });
  });

  it("parses unquoted and multiple labels, deduped, order-preserving", () => {
    expect(parseCommand("/label project.ux todo Project.UX")).toEqual({
      labels: ["project.ux", "todo"],
    });
  });

  it("mixes quoted and bare args", () => {
    expect(parseCommand('/label "needs review" project.ux')).toEqual({
      labels: ["needs review", "project.ux"],
    });
  });

  it("is case-insensitive on the command word", () => {
    expect(parseCommand("/Label todo")).toEqual({ labels: ["todo"] });
  });

  it("bare /label yields a usage error, never null", () => {
    const r = parseCommand("/label");
    expect(r.error).toMatch(/Usage/);
    expect(parseCommand("/label   ").error).toMatch(/Usage/);
  });

  it("an invalid name yields an error naming the offender", () => {
    const r = parseCommand("/label project..ux");
    expect(r.error).toContain("project..ux");
  });
});

describe("GA.core.labels.parseList", () => {
  it("separates valid and invalid tokens", () => {
    const r = parseList('todo ".bad" "needs review"');
    expect(r.labels).toEqual(["todo", "needs review"]);
    expect(r.invalid).toEqual([".bad"]);
  });

  it("empty input parses to empty lists", () => {
    expect(parseList("")).toEqual({ labels: [], invalid: [] });
    expect(parseList(null)).toEqual({ labels: [], invalid: [] });
  });
});

describe("GA.core.labels.merge", () => {
  it("unions with existing order first, deduped", () => {
    expect(merge(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(merge(null, ["x"])).toEqual(["x"]);
    expect(merge(["x"], null)).toEqual(["x"]);
  });
});

describe("GA.core.labels.selects (namespace containment)", () => {
  it("matches the label itself and its descendants", () => {
    expect(selects("project", "project")).toBe(true);
    expect(selects("project.ux.nav", "project")).toBe(true);
    expect(selects("project.ux.nav", "project.ux")).toBe(true);
  });

  it("never matches a sibling prefix or an ancestor", () => {
    expect(selects("projector", "project")).toBe(false);
    expect(selects("project", "project.ux")).toBe(false);
    expect(selects(null, "x")).toBe(false);
    expect(selects("x", null)).toBe(false);
  });
});

describe("GA.core.labels.searchMatch", () => {
  it("matches from any segment boundary, case-insensitive", () => {
    expect(searchMatch("project.ux.nav", "pro")).toBe(true);
    expect(searchMatch("project.ux.nav", "ux")).toBe(true);
    expect(searchMatch("project.ux.nav", "UX.na")).toBe(true);
  });

  it("does not match mid-segment", () => {
    expect(searchMatch("project.ux.nav", "ject")).toBe(false);
    expect(searchMatch("project.ux.nav", "x.na")).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(searchMatch("anything", "")).toBe(true);
    expect(searchMatch("anything", null)).toBe(true);
  });
});

describe("GA.core.labels.groupByNamespace", () => {
  it("groups by parent namespace, bare labels last, all sorted", () => {
    expect(groupByNamespace(["todo", "project.ux.nav", "project.ux.copy", "api.auth"])).toEqual([
      { ns: "api", labels: ["api.auth"] },
      { ns: "project.ux", labels: ["project.ux.copy", "project.ux.nav"] },
      { ns: "", labels: ["todo"] },
    ]);
  });

  it("handles empty input", () => {
    expect(groupByNamespace([])).toEqual([]);
    expect(groupByNamespace(null)).toEqual([]);
  });
});
