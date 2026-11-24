import { mintDeepgramToken } from "@/server/deepgram";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => json({ token: await mintDeepgramToken() }));
