import { ExperienceInputSchema } from "@/lib/types";
import { deleteExperience, updateExperience } from "@/server/bank";
import { entries, experiences } from "@/server/db";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";

export const dynamic = "force-dynamic";

/** The experience with the notes it was built from. */
export const GET = handler(async (_req: Request, ctx: IdContext) => {
	const experience = await experiences.require(await idFrom(ctx), "Experience");
	const sources = [];
	for (const id of experience.sourceEntryIds) {
		const entry = await entries.get(id);
		if (entry) sources.push(entry);
	}
	return json({ experience, sources });
});

export const PUT = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const input = await readBody(req, ExperienceInputSchema);
	return json({ experience: await updateExperience(id, input) });
});

export const DELETE = handler(async (_req: Request, ctx: IdContext) => {
	await deleteExperience(await idFrom(ctx));
	return json({ ok: true });
});
