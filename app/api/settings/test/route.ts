import { z } from "zod";
import { PROVIDERS } from "@/lib/types";
import { mintDeepgramToken } from "@/server/deepgram";
import { handler, json, readBody } from "@/server/http";
import { listModels } from "@/server/llm";

const TestInput = z.object({ target: z.enum([...PROVIDERS, "deepgram"]) });

/** Checks a connection without spending tokens: lists models, or mints a dictation token. */
export const POST = handler(async (req: Request) => {
	const { target } = await readBody(req, TestInput);
	if (target === "deepgram") {
		await mintDeepgramToken();
		return json({ ok: true, detail: "Deepgram accepted the key and issued a dictation token." });
	}
	const models = await listModels(target);
	return json({ ok: true, detail: `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available.`, models });
});
