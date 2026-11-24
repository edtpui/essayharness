import { z } from "zod";
import { selectAngle } from "@/server/essays";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";

const AngleInput = z.object({ index: z.number().int().min(0) });

export const PUT = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const { index } = await readBody(req, AngleInput);
	return json({ essay: await selectAngle(id, index) });
});
