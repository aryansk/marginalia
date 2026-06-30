// payload.js — pure request builders + endpoint URLs for Claude's private web
// backend (claude.ai/api). No DOM, no network, so the wire format is
// unit-testable. The transport + org/conversation setup lives in client.js.
//
// ⚠️ REVERSE-ENGINEERED & UNDOCUMENTED. If replies stop, inspect a live
// .../completion request in DevTools and adjust this file or parser.js.
var GA = (typeof GA !== "undefined" && GA) || {};
GA.claude = GA.claude || {};

GA.claude.payload = (function () {
  const ORIGIN = "https://claude.ai";
  const ORGS_URL = ORIGIN + "/api/organizations"; // -> [{ uuid, capabilities, ... }]
  // The root of every chat lives under an org. Web uses an all-zero "Nil" UUID
  // for the first message's parent.
  const ROOT_PARENT_UUID = "00000000-0000-4000-8000-000000000000";

  function conversationsUrl(orgId) {
    return ORIGIN + "/api/organizations/" + orgId + "/chat_conversations";
  }
  function completionUrl(orgId, convId) {
    return conversationsUrl(orgId) + "/" + convId + "/completion";
  }

  // Choose the org that can chat. Accounts can have several orgs; prefer one whose
  // capabilities include "chat", else the first with a uuid. Pure → testable.
  function pickOrgId(orgs) {
    if (!Array.isArray(orgs)) return null;
    const chat = orgs.find(
      (o) => o && o.uuid && Array.isArray(o.capabilities) && o.capabilities.indexOf("chat") !== -1
    );
    if (chat) return chat.uuid;
    const any = orgs.find((o) => o && o.uuid);
    return any ? any.uuid : null;
  }

  function buildConversationBody(convUuid) {
    return JSON.stringify({ uuid: convUuid, name: "" });
  }

  // The follow-up itself. `prompt` carries the full thread context already.
  function buildCompletionBody(opts) {
    const o = opts || {};
    return JSON.stringify({
      prompt: o.prompt || "",
      parent_message_uuid: o.parentUuid || ROOT_PARENT_UUID,
      timezone: o.timezone || "UTC",
      personalized_styles: [],
      attachments: [],
      files: [],
      sync_sources: [],
      rendering_mode: "messages",
    });
  }

  return {
    ORIGIN,
    ORGS_URL,
    ROOT_PARENT_UUID,
    conversationsUrl,
    completionUrl,
    pickOrgId,
    buildConversationBody,
    buildCompletionBody,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GA.claude.payload;
