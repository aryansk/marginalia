// sw.js — Chrome MV3 service-worker entry. Chrome doesn't support Firefox's
// `background.scripts` array, so this classic worker pulls in the same background
// modules in the same order via importScripts(). Firefox keeps using
// `background.scripts` (see manifest.json); Chrome uses this file (see
// manifest.chrome.json). Paths are extension-root absolute so they resolve
// regardless of where the worker lives.
importScripts(
  "/src/shared/browser-polyfill.js",
  "/src/shared/protocol.js",
  "/src/gemini/parser.js",
  "/src/gemini/payload.js",
  "/src/gemini/client.js",
  "/src/chatgpt/sha3.js",
  "/src/chatgpt/parser.js",
  "/src/chatgpt/payload.js",
  "/src/chatgpt/client.js",
  "/src/claude/parser.js",
  "/src/claude/payload.js",
  "/src/claude/client.js",
  "/src/background/clients.js",
  "/src/background.js"
);
