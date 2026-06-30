import { defineConfig } from "vitest/config";

// Pure-core specs run in Node (fast). DOM-bound specs opt in per-file with a
// `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: [
        "src/core/**",
        "src/gemini/parser.js",
        "src/gemini/payload.js",
        "src/chatgpt/sha3.js",
        "src/chatgpt/parser.js",
        "src/chatgpt/payload.js",
        "src/claude/parser.js",
        "src/claude/payload.js",
      ],
      reporter: ["text", "html"],
    },
  },
});
