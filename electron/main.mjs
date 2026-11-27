// EssayHarness desktop shell.
//
// Starts the standalone Next.js server (server.js) on 127.0.0.1:3400 in an
// Electron utility process, waits for it to answer, then shows it in a
// window. App data stays where the server expects it (default
// ~/.essayharness, override SE_DATA_DIR); nothing is written next to
// the app itself.
//
// A utility process, not a spawned copy of the app binary: the spawn made
// macOS put a second, generic "exec" icon in the Dock, bouncing, for as
// long as the server ran. Utility processes run the same Node server as
// part of this app and never appear in the Dock.
//
// The packaged server's dependencies ship as resources/node_modules, one
// level up from the server itself: electron-builder strips a top-level
// "node_modules" folder out of a resource copy (see
// scripts/stage-standalone.mjs), and Node's lookup walks up from
// server.js and finds them there with no environment help.

import { app, BrowserWindow, dialog, utilityProcess } from "electron";
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
		NODE_ENV: "production",
		HOSTNAME: HOST,
		PORT: String(PORT),
	};
	serverProcess = utilityProcess.fork(entry, [], {
		cwd: path.dirname(entry),
		env,
		stdio: "inherit",
		serviceName: "EssayHarness Server",
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
