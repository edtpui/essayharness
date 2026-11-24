import { z } from "zod";
import { getInterview } from "@/server/db";
import { handler, json, readBody } from "@/server/http";
import { generateInterview } from "@/server/interview";

export const dynamic = "force-dynamic";

export const GET = handler(async () => json({ interview: await getInterview() }));

const Generate = z.object({ count: z.number().int().min(1).max(10).default(6) });

export const POST = handler(async (req: Request) => {
	const { count } = await readBody(req, Generate);
	return json({ interview: await generateInterview(count) });
});
