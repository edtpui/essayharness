import { ExperienceInputSchema } from "@/lib/types";
import { createExperience } from "@/server/bank";
import { experiences } from "@/server/db";
import { handler, json, readBody } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
	const list = (await experiences.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return json({ experiences: list });
});

export const POST = handler(async (req: Request) => {
	const input = await readBody(req, ExperienceInputSchema);
	return json({ experience: await createExperience(input) }, 201);
});
