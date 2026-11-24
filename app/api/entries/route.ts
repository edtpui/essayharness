import { z } from "zod";
import { ENTRY_SOURCES } from "@/lib/types";
import { createEntry, extractEntry, isExtracting } from "@/server/bank";
import { entries } from "@/server/db";
import { handler, json, readBody } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
	const params = new URL(req.url).searchParams;
	const essayId = params.get("essayId");
	const list = (await entries.list())
		.filter((e) => !essayId || e.essayId === essayId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		// "running" on disk with no run in this process means a restart interrupted it.
		.map((e) =>
			e.extraction.status === "running" && !isExtracting(e.id)
				? { ...e, extraction: { ...e.extraction, status: "failed" as const, error: "Sorting was interrupted. Try again." } }
				: e,
		);
	return json({ entries: list });
});

const NewEntry = z.object({
	text: z.string(),
	source: z.enum(ENTRY_SOURCES),
	title: z.string().max(300).optional(),
	prompt: z.string().max(4000).optional(),
	essayId: z.string().nullable().optional(),
	questionId: z.string().nullable().optional(),
	interviewQuestionId: z.string().nullable().optional(),
	writingSample: z.boolean().optional(),
	/** Sort into the bank right away (default). The note is saved first either way. */
	extract: z.boolean().default(true),
});

export const POST = handler(async (req: Request) => {
	const input = await readBody(req, NewEntry);
	const entry = await createEntry(input);
	if (!input.extract) return json({ entry, experiences: [] }, 201);
	return json(await extractEntry(entry.id), 201);
});
