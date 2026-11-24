import { planEssay } from "@/server/essays";
import { handler, idFrom, json, type IdContext } from "@/server/http";

export const POST = handler(async (_req: Request, ctx: IdContext) => json({ essay: await planEssay(await idFrom(ctx)) }));
