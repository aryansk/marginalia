import { describe, it, expect } from "vitest";
import payload from "../../src/claude/payload.js";

const {
  pickOrgId,
  buildConversationBody,
  buildCompletionBody,
  conversationsUrl,
  completionUrl,
  ROOT_PARENT_UUID,
} = payload;

describe("claude pickOrgId", () => {
  it("prefers an org with the chat capability", () => {
    const orgs = [
      { uuid: "a", capabilities: ["api"] },
      { uuid: "b", capabilities: ["chat", "claude_pro"] },
    ];
    expect(pickOrgId(orgs)).toBe("b");
  });

  it("falls back to the first org with a uuid", () => {
    expect(pickOrgId([{ uuid: "x" }, { uuid: "y" }])).toBe("x");
  });

  it("returns null for empty/invalid input", () => {
    expect(pickOrgId([])).toBeNull();
    expect(pickOrgId(null)).toBeNull();
    expect(pickOrgId([{ name: "no uuid" }])).toBeNull();
  });
});

describe("claude bodies", () => {
  it("creates a conversation with the given uuid and empty name", () => {
    expect(JSON.parse(buildConversationBody("conv-1"))).toEqual({ uuid: "conv-1", name: "" });
  });

  it("sends the prompt with the nil root parent by default", () => {
    const b = JSON.parse(buildCompletionBody({ prompt: "hi — café ☕" }));
    expect(b.prompt).toBe("hi — café ☕");
    expect(b.parent_message_uuid).toBe(ROOT_PARENT_UUID);
    expect(b.rendering_mode).toBe("messages");
    expect(b.attachments).toEqual([]);
  });
});

describe("claude endpoints", () => {
  it("nest completion under the org's conversation", () => {
    expect(conversationsUrl("org")).toBe(
      "https://claude.ai/api/organizations/org/chat_conversations"
    );
    expect(completionUrl("org", "conv")).toBe(
      "https://claude.ai/api/organizations/org/chat_conversations/conv/completion"
    );
  });
});
