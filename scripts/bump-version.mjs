#!/usr/bin/env node

// Bump version across all packages in the workspace.
//
// Usage:
//   node scripts/bump-version.mjs patch   # 0.0.1 -> 0.0.2
//   node scripts/bump-version.mjs minor   # 0.0.1 -> 0.1.0
//   node scripts/bump-version.mjs major   # 0.0.1 -> 1.0.0
//   node scripts/bump-version.mjs 1.2.3   # set explicit version

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES_DIR = join(ROOT, "packages");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function bumpSemver(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      // Explicit version
      if (/^\d+\.\d+\.\d+/.test(type)) return type;
      console.error(`Unknown bump type: ${type}`);
      process.exit(1);
  }
}

// Parse args
const bumpType = process.argv[2];
if (!bumpType) {
  console.error(
    "Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>",
  );
  process.exit(1);
}

// Get current version from root package.json
const rootPkg = readJson(join(ROOT, "package.json"));
const currentVersion = rootPkg.version || "0.0.1";
const newVersion = bumpSemver(currentVersion, bumpType);

console.log(`Bumping: ${currentVersion} → ${newVersion}\n`);

// Update root package.json
rootPkg.version = newVersion;
writeJson(join(ROOT, "package.json"), rootPkg);
console.log(`  root/package.json → ${newVersion}`);

// Update all workspace packages
const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const dir of packageDirs) {
  const pkgPath = join(PACKAGES_DIR, dir, "package.json");
  if (!existsSync(pkgPath)) continue;

  const pkg = readJson(pkgPath);
  pkg.version = newVersion;
  writeJson(pkgPath, pkg);
  console.log(`  packages/${dir}/package.json → ${newVersion}`);
}

// Update extension manifest.json
const manifestPath = join(PACKAGES_DIR, "extension", "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = readJson(manifestPath);
  manifest.version = newVersion;
  writeJson(manifestPath, manifest);
  console.log(`  packages/extension/manifest.json → ${newVersion}`);
}

console.log(`\nDone. All packages updated to ${newVersion}`);
console.log(
  'Run: git add -A && git commit -m "Bump version to ' + newVersion + '"',
);
