import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ZodType } from "zod";
import { HttpError } from "./errors";

/* Plain JSON files under one data directory: one file per record, written
 * atomically (temp file + rename), with in-process locks around every
 * read-modify-write. This app runs as a single server process, so
 * in-process locking is sufficient. */

export function dataDir(): string {
	const configured = process.env.SE_DATA_DIR?.trim();
	// The data folder is runtime state outside the build; keep the bundler from tracing it.
	return path.resolve(/*turbopackIgnore: true*/ configured || path.join(os.homedir(), ".scholarship-essays"));
}

const ID_PATTERN = /^[a-z]{1,4}_[a-f0-9]{12}$/;

export function newId(prefix: string): string {
	return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function assertId(id: string): void {
	if (!ID_PATTERN.test(id)) throw new HttpError(400, `Invalid id "${id.slice(0, 40)}"`);
}

export function nowIso(): string {
	return new Date().toISOString();
}

type LockState = { locks: Map<string, Promise<unknown>> };
const g = globalThis as typeof globalThis & { __seStoreLocks?: LockState };
const lockState: LockState = (g.__seStoreLocks ??= { locks: new Map() });

/** Runs fn after every earlier holder of the same key has finished. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = lockState.locks.get(key) ?? Promise.resolve();
	const run = prev.catch(() => undefined).then(fn);
	const tail = run.catch(() => undefined);
	lockState.locks.set(key, tail);
	void tail.then(() => {
		if (lockState.locks.get(key) === tail) lockState.locks.delete(key);
	});
	return run;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeFileAtomic(file: string, data: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	await fs.writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(tmp, file);
			return;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			// Windows: antivirus or an indexer can hold the target briefly.
			if ((code === "EPERM" || code === "EBUSY" || code === "EACCES") && attempt < 6) {
				await sleep(40 * (attempt + 1));
				continue;
			}
			await fs.rm(tmp, { force: true });
			throw err;
		}
	}
}

export class CorruptRecordError extends Error {
	constructor(
		public readonly file: string,
		detail: string,
	) {
		super(`Stored file ${file} is unreadable: ${detail}`);
		this.name = "CorruptRecordError";
	}
}

export async function readJsonFile<T>(file: string, schema: ZodType<T>): Promise<T | null> {
	let raw: string;
	try {
		raw = await fs.readFile(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw new CorruptRecordError(file, (err as Error).message);
	}
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new CorruptRecordError(file, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
	return parsed.data;
}

export type CollectionName = "entries" | "experiences" | "essays";

export interface Collection<T extends { id: string }> {
	get(id: string): Promise<T | null>;
	require(id: string, label: string): Promise<T>;
	list(): Promise<T[]>;
	put(item: T): Promise<void>;
	update(id: string, label: string, fn: (current: T) => T | Promise<T>): Promise<T>;
	remove(id: string): Promise<void>;
}

export function collection<T extends { id: string }>(name: CollectionName, schema: ZodType<T>): Collection<T> {
	const dir = () => path.join(dataDir(), name);
	const file = (id: string) => {
		assertId(id);
		return path.join(dir(), `${id}.json`);
	};
	const key = (id: string) => `${name}:${id}`;
	const write = (item: T) => writeFileAtomic(file(item.id), `${JSON.stringify(item, null, 2)}\n`);

	const api: Collection<T> = {
		get: async (id) => readJsonFile(file(id), schema),
		async require(id, label) {
			const item = await api.get(id);
			if (!item) throw new HttpError(404, `${label} not found`);
			return item;
		},
		async list() {
			let names: string[];
			try {
				names = await fs.readdir(dir());
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw err;
			}
			const items: T[] = [];
			for (const fileName of names) {
				if (!fileName.endsWith(".json")) continue;
				const id = fileName.slice(0, -5);
				if (!ID_PATTERN.test(id)) continue;
				try {
					const item = await readJsonFile(path.join(dir(), fileName), schema);
					if (item) items.push(item);
				} catch (err) {
					// One damaged file must not hide the rest; it stays on disk for repair.
					console.error(`[store] skipping ${name}/${fileName}:`, (err as Error).message);
				}
			}
			return items;
		},
		put: (item) => withLock(key(item.id), () => write(item)),
		update: (id, label, fn) =>
			withLock(key(id), async () => {
				const current = await api.get(id);
				if (!current) throw new HttpError(404, `${label} not found`);
				const next = await fn(current);
				await write(next);
				return next;
			}),
		remove: (id) =>
			withLock(key(id), async () => {
				await fs.rm(file(id), { force: true });
			}),
	};
	return api;
}

export type SingletonName = "settings" | "credentials" | "profile" | "interview";

export function singletonPath(name: SingletonName): string {
	return path.join(dataDir(), `${name}.json`);
}

export async function readSingleton<T>(name: SingletonName, schema: ZodType<T>, fallback: () => T): Promise<T> {
	return (await readJsonFile(singletonPath(name), schema)) ?? fallback();
}

export function updateSingleton<T>(name: SingletonName, schema: ZodType<T>, fallback: () => T, fn: (current: T) => T): Promise<T> {
	return withLock(`singleton:${name}`, async () => {
		const current = await readSingleton(name, schema, fallback);
		const next = fn(current);
		await writeFileAtomic(singletonPath(name), `${JSON.stringify(next, null, 2)}\n`);
		return next;
	});
}

export async function appendLine(fileName: string, line: string): Promise<void> {
	const file = path.join(dataDir(), fileName);
	await withLock(`append:${fileName}`, async () => {
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.appendFile(file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
	});
}

export async function readLines(fileName: string): Promise<string[]> {
	try {
		const raw = await fs.readFile(path.join(dataDir(), fileName), "utf8");
		return raw.split("\n").filter((l) => l.trim());
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
}
