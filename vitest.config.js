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
        "src/shared/sse.js",
        "src/background/api-util.js",
        "src/background/api-client-factory.js",
        "src/background/registry.js",
        "src/background/clients.js",
        "src/gemini/parser.js",
        "src/gemini/payload.js",
        "src/gemini/client.js",
        "src/claude/parser.js",
        "src/claude/payload.js",
        "src/claude/client.js",
        "src/openai/parser.js",
        "src/openai/payload.js",
        "src/openai/client.js",
        "src/googleai/parser.js",
        "src/googleai/payload.js",
        "src/googleai/client.js",
        "src/anthropic/parser.js",
        "src/anthropic/payload.js",
        "src/anthropic/client.js",
      ],
      reporter: ["text", "html"],
    },
  },
});
