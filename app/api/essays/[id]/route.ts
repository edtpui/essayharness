import { EssayBriefInputSchema } from "@/lib/types";
import { essays } from "@/server/db";
import { deleteEssay, updateBrief } from "@/server/essays";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";
import { activeRun } from "@/server/runs";
import { usageSummary } from "@/server/usage";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const [essay, usage] = await Promise.all([essays.require(id, "Essay"), usageSummary()]);
	return json({ essay, run: activeRun(id), costUsd: usage.byEssay[id] ?? 0 });
});

export const PATCH = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const input = await readBody(req, EssayBriefInputSchema);
	return json({ essay: await updateBrief(id, input) });
});

export const DELETE = handler(async (_req: Request, ctx: IdContext) => {
	await deleteEssay(await idFrom(ctx));
	return json({ ok: true });
});
