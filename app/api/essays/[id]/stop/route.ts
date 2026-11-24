import { handler, idFrom, json, type IdContext } from "@/server/http";
import { stopRun } from "@/server/runs";

export const POST = handler(async (_req: Request, ctx: IdContext) => json({ stopped: stopRun(await idFrom(ctx)) }));
