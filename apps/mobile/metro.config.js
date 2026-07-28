const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo: resolve hoisted node_modules and include workspace sources.
// Watch ONLY the workspace source we actually edit (packages/shared). Never
// add node_modules here — module resolution uses `nodeModulesPaths` below, and
// recursively watching the hoisted node_modules (700+ packages) makes Metro's
// file-map watcher time out on Windows without Watchman ("Failed to start
// watch mode").
config.watchFolders = [path.resolve(monorepoRoot, "packages/shared")];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
