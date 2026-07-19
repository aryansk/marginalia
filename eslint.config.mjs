// Flat ESLint config. Three dialects live in this repo:
//  - src/**: plain browser scripts on the shared GA namespace (no modules); the
//    guarded `module.exports` tail on each file needs the CommonJS globals.
//  - build.js + tools/**: Node CommonJS scripts.
//  - tests/** + the config files: ESM run by vitest/Node.
// Generated code (src/core/tex-tables.js) and build output are not linted.
import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

const tuned = {
  // Deliberate empty catches are annotated at the call site; the annotation is
  // the contract, not a lint suppression per line.
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
};

export default [
  {
    ignores: [
      "dist/",
      "coverage/",
      "web-ext-artifacts/",
      "node_modules/",
      "src/core/tex-tables.js", // generated — see tools/gen-tex-tables.js
      "tickets/",
    ],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        module: "readonly",
        require: "readonly",
      },
    },
    rules: { ...js.configs.recommended.rules, ...tuned },
  },
  {
    // Chrome's MV3 service worker uses the worker global importScripts().
    files: ["src/sw.js"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    // The options page reads the GA namespace that options.html's script tags
    // assembled; unlike content/background files it never declares it.
    files: ["src/options/options.js"],
    languageOptions: { globals: { GA: "readonly" } },
  },
  {
    // tools/probe-turns.js is pasted into a browser console, so the tools
    // block gets browser globals alongside node.
    files: ["build.js", "tools/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...js.configs.recommended.rules, ...tuned },
  },
  {
    files: ["tests/**/*.js", "vitest.config.js", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...js.configs.recommended.rules, ...tuned },
  },
  prettier,
];
