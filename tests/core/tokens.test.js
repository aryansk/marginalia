import { describe, it, expect } from "vitest";
import tokens from "../../src/core/tokens.js";

const { grab, scrapeTokens } = tokens;

describe("grab", () => {
  it("reads a quoted string value", () => {
    expect(grab('{"SNlM0e":"AB12:99"}', "SNlM0e")).toBe("AB12:99");
  });

  it("reads an unquoted numeric value (FdrFje is sometimes a number)", () => {
    expect(grab('{"FdrFje":-1234567890}', "FdrFje")).toBe("-1234567890");
  });

  it("returns null when the key is missing", () => {
    expect(grab('{"other":"x"}', "SNlM0e")).toBeNull();
  });
});

describe("scrapeTokens", () => {
  it("extracts all three tokens from one script text", () => {
    const text = 'window.WIZ_global_data={"SNlM0e":"AT","cfb2h":"boq_x","FdrFje":"99"};';
    expect(scrapeTokens([text])).toEqual({ at: "AT", bl: "boq_x", sid: "99" });
  });

  it("finds tokens split across multiple script texts", () => {
    const a = '{"SNlM0e":"AT"}';
    const b = '{"cfb2h":"boq_x"}';
    const c = '{"FdrFje":42}';
    expect(scrapeTokens([a, b, c])).toEqual({ at: "AT", bl: "boq_x", sid: "42" });
  });

  it("skips empty / null script texts", () => {
    expect(scrapeTokens([null, "", '{"SNlM0e":"AT"}'])).toEqual({ at: "AT", bl: null, sid: null });
  });

  it("returns nulls (no throw) when nothing matches", () => {
    expect(scrapeTokens(["no tokens here", ""])).toEqual({ at: null, bl: null, sid: null });
    expect(scrapeTokens([])).toEqual({ at: null, bl: null, sid: null });
    expect(scrapeTokens(undefined)).toEqual({ at: null, bl: null, sid: null });
  });
});
