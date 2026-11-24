// Stages the standalone Next.js build into dist-app/, the folder
// electron-builder packages:
//
//   dist-app/package.json      minimal manifest (name/version from package.json)
//   dist-app/electron/main.mjs the Electron shell
//   dist-app/server/           standalone output plus .next/static and public/
//
// `npm run dist` and `npm run pack` build with SE_STANDALONE=1 and then run
// this script; calling it directly fails if the standalone build is missing.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "dist-app");

if (!existsSync(path.join(standalone, "server.js"))) {
	console.error(
		"No standalone build at .next/standalone. Build with SE_STANDALONE=1 first (npm run dist does this).",
	);
	process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "server"), { recursive: true });
await mkdir(path.join(out, "electron"), { recursive: true });

// The standalone output is self-contained except for the static assets and
// public/, which Next.js expects next to server.js (the same layout the
// Dockerfile assembles).
await cp(standalone, path.join(out, "server"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(out, "server", ".next", "static"), {
	recursive: true,
});
if (existsSync(path.join(root, "public"))) {
	await cp(path.join(root, "public"), path.join(out, "server", "public"), { recursive: true });
}

await cp(path.join(root, "electron", "main.mjs"), path.join(out, "electron", "main.mjs"));

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = {
	name: pkg.name,
	version: pkg.version,
	description: pkg.description,
	main: "electron/main.mjs",
};
await writeFile(path.join(out, "package.json"), JSON.stringify(manifest, null, "\t") + "\n");

console.log("Staged the desktop app in dist-app/ (electron/ shell, server/ standalone app).");
