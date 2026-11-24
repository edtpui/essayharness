import { z } from "zod";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";
import { setInterviewQuestionStatus } from "@/server/interview";

const Patch = z.object({ status: z.enum(["open", "skipped"]) });

export const PATCH = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const { status } = await readBody(req, Patch);
	return json({ interview: await setInterviewQuestionStatus(id, status) });
});
