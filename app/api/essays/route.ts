import { EssayBriefInputSchema } from "@/lib/types";
import { measure } from "@/lib/text";
import { essays } from "@/server/db";
import { createEssay } from "@/server/essays";
import { handler, json, readBody } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
	const list = (await essays.list())
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.map((e) => {
			const latest = e.versions.at(-1);
			return {
				id: e.id,
				title: e.title,
				scholarship: e.scholarship,
				limit: e.limit,
				createdAt: e.createdAt,
				updatedAt: e.updatedAt,
				planned: e.plan !== null,
				openQuestions: e.questions.filter((q) => q.status === "open").length,
				versions: e.versions.length,
				latestLength: latest ? measure(latest.text, e.limit) : null,
			};
		});
	return json({ essays: list });
});

export const POST = handler(async (req: Request) => {
	const input = await readBody(req, EssayBriefInputSchema);
	return json({ essay: await createEssay(input) }, 201);
});
