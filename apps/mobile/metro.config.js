const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// The shared Minerva network packages (@minerva/sdk, pq-native-tx, chain-config) are linked
// from the sibling network repository (pnpm `link:` overrides in package.json). Metro only
// resolves inside its watch folders, so that tree must be watched too when it exists.
const networkRoot = path.resolve(workspaceRoot, "../network");
const fs = require("fs");
const hasNetwork = fs.existsSync(path.join(networkRoot, "packages"));

// Watch the whole monorepo so workspace package edits hot-reload.
config.watchFolders = hasNetwork ? [workspaceRoot, networkRoot] : [workspaceRoot];

// Use the workspace node_modules first, then fall back to app-local, then the network workspace.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
  ...(hasNetwork ? [path.resolve(networkRoot, "node_modules")] : []),
];

// Allow pnpm package-local dependencies such as Expo Router's runtime helpers
// to resolve from the package that imports them.
config.resolver.disableHierarchicalLookup = false;

module.exports = withNativeWind(config, { input: "./global.css" });
