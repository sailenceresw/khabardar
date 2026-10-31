const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo: resolve hoisted node_modules and include workspace sources.
// Watch ONLY the workspace sources we actually edit. Never add node_modules
// here — module resolution uses `nodeModulesPaths` below, and recursively
// watching the hoisted node_modules (700+ packages) makes Metro's file-map
// watcher time out on Windows without Watchman ("Failed to start watch mode").
//
// `expo-tor` is a workspace package symlinked into node_modules, so Metro needs
// its real path watched — the package root, not just `src`, because resolving
// the symlink means reading that package.json for its `main` field.
config.watchFolders = [
  path.resolve(monorepoRoot, "packages/shared"),
  path.resolve(monorepoRoot, "modules/expo-tor"),
];

// …but never its Rust tree. `rust/target` holds hundreds of thousands of build
// artifacts, and on Windows without Watchman that is enough to make Metro's
// file-map crawler hang exactly the way the note above describes.
const rustDir = path.resolve(monorepoRoot, "modules/expo-tor/rust");
const escaped = rustDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockRust = new RegExp(`^${escaped}[\\\\/].*`);

config.resolver.blockList = Array.isArray(config.resolver.blockList)
  ? [...config.resolver.blockList, blockRust]
  : config.resolver.blockList
    ? [config.resolver.blockList, blockRust]
    : [blockRust];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Watchman is installed on this machine but `watch-project` / `query` hang
// for minutes on the monorepo (see README troubleshooting). A hung watcher
// looks like a dead app. Metro's own crawler is slower and actually starts.
config.resolver.useWatchman = false;

module.exports = config;
