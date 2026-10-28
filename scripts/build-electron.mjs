import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const targets = ["--mac", "--win", "--linux"].filter((flag) => args.includes(flag));
if (targets.length > 1) throw new Error("Build one operating system and architecture at a time.");
const platform = args.includes("--mac") ? "darwin" : args.includes("--win") ? "win32" : args.includes("--linux") ? "linux" : process.platform;
if (args.includes("--x64") && args.includes("--arm64")) throw new Error("Build Intel and Apple Silicon separately so the bundled validator matches the app.");
const arch = args.includes("--x64") ? "x64" : args.includes("--arm64") ? "arm64" : platform === "darwin" ? process.arch : "x64";

function run(script, parameters) {
  const result = spawnSync(process.execPath, [script, ...parameters], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("scripts/einvoice-prepare.mjs", ["--platform", platform, "--arch", arch]);
run("scripts/einvoice-prepare.mjs", ["--platform", platform, "--arch", arch, "--check"]);
run(require.resolve("electron-builder/cli.js"), [...args, ...(args.includes(`--${arch}`) ? [] : [`--${arch}`])]);
