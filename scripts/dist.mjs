// Builds and packages the desktop app for the current OS.
//
//   npm run dist   installer in dist/ (Windows .exe, macOS .dmg)
//   npm run pack   unpacked app in dist/ (faster, for testing)
//
// Steps: build Next.js with SE_STANDALONE=1, stage the standalone output
// into dist-app/, then run electron-builder. This script's extra arguments
// (for example --dir from `npm run pack`) are passed to electron-builder.

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, env = {}) =>
	execSync(command, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

run("npx next build", { SE_STANDALONE: "1" });
run("node scripts/stage-standalone.mjs");
run(`npx electron-builder ${process.argv.slice(2).join(" ")}`);
