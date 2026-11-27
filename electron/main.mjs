// EssayHarness desktop shell.
//
// Starts the standalone Next.js server (server.js) on 127.0.0.1:3400 using
// Electron's bundled Node runtime, waits for it to answer, then shows it in
// a window. App data stays where the server expects it (default
// ~/.essayharness, override SE_DATA_DIR); nothing is written next to
// the app itself.
//
// The packaged server's dependencies ship as resources/server/server_deps,
// not node_modules: electron-builder strips a top-level "node_modules"
// folder out of extraResources (see scripts/stage-standalone.mjs). The
// spawn below therefore sets NODE_PATH to that folder so the server's
// require() calls resolve.

import { app, BrowserWindow, dialog } from "electron";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 3400;
const HOME_URL = `http://${HOST}:${PORT}/`;

let serverProcess = null;
let mainWindow = null;
let quitting = false;

function serverEntry() {
	if (app.isPackaged) {
		// electron-builder ships the staged standalone app as resources/server.
		return path.join(process.resourcesPath, "server", "server.js");
	}
	// Unpackaged (electron .): run the standalone build in the repo.
	const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
	return path.join(repoRoot, ".next", "standalone", "server.js");
}

function startServer() {
	const entry = serverEntry();
	const env = {
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
		NODE_ENV: "production",
		HOSTNAME: HOST,
		PORT: String(PORT),
	};
	if (app.isPackaged) {
		// The dependencies live in server_deps, not node_modules (see the
		// header comment); NODE_PATH is where require() looks for them.
		const deps = path.join(process.resourcesPath, "server", "server_deps");
		env.NODE_PATH = env.NODE_PATH ? deps + path.delimiter + env.NODE_PATH : deps;
	}
	serverProcess = spawn(process.execPath, [entry], {
		cwd: path.dirname(entry),
		env,
		stdio: "inherit",
	});
	serverProcess.on("exit", (code) => {
		serverProcess = null;
		if (!quitting && code !== 0) {
			dialog.showErrorBox(
				"EssayHarness",
				`The local server stopped unexpectedly (exit code ${code}).`,
			);
			app.quit();
		}
	});
}

function waitForServer(timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const req = http.get(HOME_URL, (res) => {
				res.resume();
				resolve();
			});
			req.on("error", () => {
				if (Date.now() > deadline) {
					reject(new Error(`The local server did not start within ${timeoutMs / 1000} seconds.`));
				} else {
					setTimeout(attempt, 250);
				}
			});
		};
		attempt();
	});
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		title: "EssayHarness",
	});
	mainWindow.loadURL(HOME_URL);
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

app.whenReady().then(async () => {
	startServer();
	try {
		await waitForServer();
	} catch (err) {
		dialog.showErrorBox("EssayHarness", String(err));
		app.quit();
		return;
	}
	createWindow();

	app.on("activate", () => {
		// macOS: re-open the window when the dock icon is clicked.
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	quitting = true;
	if (serverProcess) serverProcess.kill();
});
