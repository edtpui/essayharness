import { z } from "zod";
import { setQuestionStatus } from "@/server/essays";
import { handler, json, readBody } from "@/server/http";
import { assertId } from "@/server/store";

type Ctx = { params: Promise<{ id: string; qid: string }> };

const Patch = z.object({ status: z.enum(["open", "skipped"]) });

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
	const { id, qid } = await ctx.params;
	assertId(id);
	assertId(qid);
	const { status } = await readBody(req, Patch);
	return json({ essay: await setQuestionStatus(id, qid, status) });
});
