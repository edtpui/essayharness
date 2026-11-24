import { handler, idFrom, json, type IdContext } from "@/server/http";
import { reviewEntry } from "@/server/uploads";

export const POST = handler(async (_req: Request, ctx: IdContext) => json({ entry: await reviewEntry(await idFrom(ctx)) }));
