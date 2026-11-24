import { z } from "zod";
import { deleteEntry, updateEntry } from "@/server/bank";
import { entries } from "@/server/db";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	return json({ entry: await entries.require(id, "Note") });
});

const Patch = z.object({ text: z.string().optional(), writingSample: z.boolean().optional() });

export const PATCH = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const patch = await readBody(req, Patch);
	return json({ entry: await updateEntry(id, patch) });
});

export const DELETE = handler(async (_req: Request, ctx: IdContext) => {
	await deleteEntry(await idFrom(ctx));
	return json({ ok: true });
});
