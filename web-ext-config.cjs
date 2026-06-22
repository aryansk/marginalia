// web-ext config: keep dev-only files out of the lint scope and the built package.
module.exports = {
  ignoreFiles: [
    "test",
    "test/**",
    "package.json",
    "package-lock.json",
    "web-ext-config.cjs",
    "README.md",
    "web-ext-artifacts",
    "mise.toml",
  ],
};
