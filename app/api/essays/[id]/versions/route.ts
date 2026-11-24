import { z } from "zod";
import { saveManualVersion } from "@/server/essays";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";

const ManualVersion = z.object({ text: z.string().max(100000) });

/** Saves the person's own edit of a draft as a new version. */
export const POST = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const { text } = await readBody(req, ManualVersion);
	return json({ essay: await saveManualVersion(id, text) }, 201);
});
