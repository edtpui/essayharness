import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Points the store at a fresh temporary data directory. */
export async function useTempDataDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "se-test-"));
	process.env.SE_DATA_DIR = dir;
	return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
