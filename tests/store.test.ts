import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { z } from "zod";
import { HttpError } from "@/server/errors";
import { collection, newId, readJsonFile, withLock, writeFileAtomic } from "@/server/store";
import { useTempDataDir } from "./helpers/temp-data";

let cleanup: () => Promise<void>;
let dir: string;
before(async () => ({ dir, cleanup } = await useTempDataDir()));
after(() => cleanup());

const Item = z.object({ id: z.string(), value: z.number(), note: z.string().default("") });
const items = collection("entries", Item);

test("put, get, list, update and remove round-trip", async () => {
	const id = newId("ent");
	await items.put({ id, value: 1, note: "" });
	assert.deepEqual(await items.get(id), { id, value: 1, note: "" });
	const updated = await items.update(id, "Item", (cur) => ({ ...cur, value: cur.value + 1 }));
	assert.equal(updated.value, 2);
	assert.equal((await items.list()).length, 1);
	await items.remove(id);
	assert.equal(await items.get(id), null);
});

test("ids that could escape the data directory are rejected", async () => {
	await assert.rejects(items.get("../../etc/passwd"), (err: unknown) => err instanceof HttpError && err.status === 400);
	await assert.rejects(items.get("ent_ZZZZZZZZZZZZ"), HttpError);
});

test("update on a missing record is a 404", async () => {
	await assert.rejects(
		items.update(newId("ent"), "Item", (c) => c),
		(err: unknown) => err instanceof HttpError && err.status === 404,
	);
});

test("list skips a corrupt file instead of failing", async () => {
	const good = newId("ent");
	await items.put({ id: good, value: 5, note: "" });
	await fs.writeFile(path.join(dir, "entries", `${newId("ent")}.json`), "{ not json");
	const originalError = console.error;
	console.error = () => undefined;
	try {
		const list = await items.list();
		assert.ok(list.some((i) => i.id === good));
	} finally {
		console.error = originalError;
	}
});

test("defaults fill fields missing from older files", async () => {
	const id = newId("ent");
	await fs.writeFile(path.join(dir, "entries", `${id}.json`), JSON.stringify({ id, value: 3 }));
	assert.deepEqual(await items.get(id), { id, value: 3, note: "" });
});

test("concurrent updates to one record are serialised", async () => {
	const id = newId("ent");
	await items.put({ id, value: 0, note: "" });
	await Promise.all(
		Array.from({ length: 25 }, () =>
			items.update(id, "Item", async (cur) => {
				await new Promise((r) => setTimeout(r, 1));
				return { ...cur, value: cur.value + 1 };
			}),
		),
	);
	assert.equal((await items.get(id))?.value, 25);
});

test("withLock runs holders of a key one at a time, in order", async () => {
	const order: number[] = [];
	await Promise.all(
		[3, 1, 2].map((delay, i) =>
			withLock("k", async () => {
				await new Promise((r) => setTimeout(r, delay));
				order.push(i);
			}),
		),
	);
	assert.deepEqual(order, [0, 1, 2]);
});

test("a failed holder does not block the next", async () => {
	await assert.rejects(withLock("k2", async () => Promise.reject(new Error("boom"))));
	assert.equal(await withLock("k2", async () => "ok"), "ok");
});

test("writeFileAtomic leaves no temp files behind", async () => {
	const file = path.join(dir, "atomic", "a.json");
	await writeFileAtomic(file, '{"x":1}');
	await writeFileAtomic(file, '{"x":2}');
	assert.deepEqual(await readJsonFile(file, z.object({ x: z.number() })), { x: 2 });
	assert.deepEqual(await fs.readdir(path.dirname(file)), ["a.json"]);
});
