import { handler, json } from "@/server/http";
import { usageSummary } from "@/server/usage";

export const dynamic = "force-dynamic";

export const GET = handler(async () => json({ usage: await usageSummary() }));
