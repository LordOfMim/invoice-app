import fs from "node:fs";
import path from "node:path";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source directory: ${src}`);
  }
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force: true });
}

// Run from repo root
const root = process.cwd();

const nextDir = path.join(root, ".next");
const standaloneDir = path.join(nextDir, "standalone");

if (!fs.existsSync(standaloneDir)) {
  throw new Error(
    "Missing .next/standalone. Ensure next.config.ts has output: 'standalone' and run `next build` first."
  );
}

// Next standalone server expects these paths relative to the standalone folder.
const staticSrc = path.join(nextDir, "static");
const staticDest = path.join(standaloneDir, ".next", "static");

const publicSrc = path.join(root, "public");
const publicDest = path.join(standaloneDir, "public");

console.log("[prepare-electron-standalone] Copying Next static assets...");
copyDir(staticSrc, staticDest);

console.log("[prepare-electron-standalone] Copying public assets...");
copyDir(publicSrc, publicDest);

console.log("[prepare-electron-standalone] Done.");
