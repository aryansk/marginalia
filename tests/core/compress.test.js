import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGA } from "../helpers/loadGA.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const GA = loadGA(["src/core/compress.js"]);
const { gzipToB64, b64ToText } = GA.core.compress;

const hasStreams =
  typeof globalThis.CompressionStream === "function" &&
  typeof globalThis.DecompressionStream === "function";

const roundTrip = async (s) => b64ToText(await gzipToB64(s));

// Round-trip specs need the platform codec; skip (never fail) where it's absent.
describe.skipIf(!hasStreams)("GA.core.compress round-trips", () => {
  it("ASCII message text", async () => {
    const s = "Hello, this is a plain ASCII model reply.\nWith a second line.";
    expect(await roundTrip(s)).toBe(s);
  });

  it("empty string", async () => {
    expect(await roundTrip("")).toBe("");
  });

  it("unicode text (emoji, CJK, combining marks, RTL)", async () => {
    const s = "naïve — 例えば 🧵🚀 ́combining ﷺ العربية ✓";
    expect(await roundTrip(s)).toBe(s);
  });

  it("a >100 KB non-ASCII payload survives chunked base64 marshalling", async () => {
    // Mixed-width code points so byte offsets never align with the chunk size.
    const unit = "The quick brown fox 🦊 jumps — 速い茶色の狐が跳ぶ — über den faulen Hund. ";
    const s = unit.repeat(Math.ceil((150 * 1024) / unit.length));
    expect(s.length).toBeGreaterThan(100 * 1024);
    expect(await roundTrip(s)).toBe(s);
  });

  it("lone surrogates degrade to well-formed replacement text, never throw", async () => {
    const s = "broken \uD83D surrogate \uDC00 tail";
    // UTF-8 cannot carry lone surrogates; TextEncoder substitutes U+FFFD.
    const wellFormed = new TextDecoder().decode(new TextEncoder().encode(s));
    expect(await roundTrip(s)).toBe(wellFormed);
  });

  it("produces base64 output (safe to store as plain JSON)", async () => {
    const b64 = await gzipToB64("some message body");
    expect(typeof b64).toBe("string");
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("compresses repetitive text (blob smaller than the input)", async () => {
    const s = "the same sentence over and over. ".repeat(2000);
    const b64 = await gzipToB64(s);
    expect(b64.length).toBeLessThan(s.length / 10);
  });

  it("b64ToText rejects on garbage input instead of returning wrong text", async () => {
    await expect(b64ToText("dGhpcyBpcyBub3QgZ3ppcA==")).rejects.toThrow();
  });
});

describe("GA.core.compress layering", () => {
  it("exposes exactly the async pair gzipToB64 / b64ToText", () => {
    expect(Object.keys(GA.core.compress).sort()).toEqual(["b64ToText", "gzipToB64"]);
    expect(typeof gzipToB64).toBe("function");
    expect(typeof b64ToText).toBe("function");
  });

  it("never touches storage or the DOM (pure IO codec)", () => {
    const src = fs
      .readFileSync(path.join(ROOT, "src/core/compress.js"), "utf8")
      .replace(/\/\/.*$/gm, ""); // the header comment may NAME storage; the code must not touch it
    expect(src).not.toMatch(/browser\.|chrome\.|storage|document\.|innerHTML/);
  });
});
