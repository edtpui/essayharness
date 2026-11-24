import { extractEntry } from "@/server/bank";
import { handler, idFrom, json, type IdContext } from "@/server/http";

export const POST = handler(async (_req: Request, ctx: IdContext) => json(await extractEntry(await idFrom(ctx))));
