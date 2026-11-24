import { z } from "zod";
import { auditEssay } from "@/server/essays";
import { handler, idFrom, json, readBody, type IdContext } from "@/server/http";

const AuditInput = z.object({ versionId: z.string().optional() });

export const POST = handler(async (req: Request, ctx: IdContext) => {
	const id = await idFrom(ctx);
	const { versionId } = await readBody(req, AuditInput);
	return json({ essay: await auditEssay(id, versionId) });
});
