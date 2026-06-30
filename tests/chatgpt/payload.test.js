import { describe, it, expect } from "vitest";
import payload from "../../src/chatgpt/payload.js";
import { loadGA } from "../helpers/loadGA.js";

const { buildConversationBody, buildRequirementsBody, CONVERSATION_URL, AUTH_URL } = payload;

describe("chatgpt buildConversationBody", () => {
  it("sends the prompt as a single user text message", () => {
    const body = JSON.parse(
      buildConversationBody({ prompt: "why 8kb?", messageId: "m1", parentId: "p1" })
    );
    expect(body.action).toBe("next");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].author.role).toBe("user");
    expect(body.messages[0].content.parts).toEqual(["why 8kb?"]);
    expect(body.messages[0].id).toBe("m1");
    expect(body.parent_message_id).toBe("p1");
  });

  it("defaults the model to auto and preserves unicode/newlines", () => {
    const prompt = 'Why "8 KB"?\nLine 2 — café ☕';
    const body = JSON.parse(buildConversationBody({ prompt, messageId: "m", parentId: "p" }));
    expect(body.model).toBe("auto");
    expect(body.messages[0].content.parts[0]).toBe(prompt);
  });
});

describe("chatgpt buildRequirementsBody", () => {
  it("wraps the proof token under p", () => {
    expect(JSON.parse(buildRequirementsBody("abc"))).toEqual({ p: "abc" });
    expect(JSON.parse(buildRequirementsBody())).toEqual({ p: "" });
  });
});

describe("chatgpt endpoints", () => {
  it("point at chatgpt.com backend", () => {
    expect(CONVERSATION_URL).toContain("chatgpt.com/backend-api/conversation");
    expect(AUTH_URL).toContain("chatgpt.com/api/auth/session");
  });
});

// buildProofToken needs the sibling sha3 module on the same GA global.
describe("chatgpt buildProofToken (Sentinel proof-of-work)", () => {
  const ga = loadGA(["src/chatgpt/sha3.js", "src/chatgpt/payload.js"]);
  const { buildProofToken } = ga.chatgpt.payload;
  const sha = ga.chatgpt.sha3.sha3_512;
  const opts = { now: "Mon Jan 01 2025 00:00:00 GMT+0000", core: 8, screen: 3000, maxIter: 200000 };

  it("returns a gAAAAAB token whose hash satisfies the difficulty", () => {
    const seed = "seed-xyz";
    const token = buildProofToken(seed, "0", "UA/1.0", opts);
    expect(token.startsWith("gAAAAAB")).toBe(true);
    const base = token.slice("gAAAAAB".length);
    expect(sha(seed + base).substring(0, 1) <= "0").toBe(true);
  });

  it("is deterministic for fixed inputs", () => {
    expect(buildProofToken("s", "0", "UA", opts)).toBe(buildProofToken("s", "0", "UA", opts));
  });

  it("handles a 2-hex-char difficulty", () => {
    const token = buildProofToken("abc", "0f", "UA", opts);
    const base = token.slice("gAAAAAB".length);
    expect(sha("abc" + base).substring(0, 2) <= "0f").toBe(true);
  });
});
