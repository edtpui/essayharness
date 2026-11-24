import { z } from "zod";
import { PROVIDERS } from "@/lib/types";
import { HttpError } from "@/server/errors";
import { handler, json } from "@/server/http";
import { listModels } from "@/server/llm";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
	const parsed = z.enum(PROVIDERS).safeParse(new URL(req.url).searchParams.get("provider"));
	if (!parsed.success) throw new HttpError(400, "Unknown provider");
	return json({ models: await listModels(parsed.data) });
});
