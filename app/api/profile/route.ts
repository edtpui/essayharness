import { ProfileInputSchema } from "@/lib/types";
import { getProfile, saveProfile } from "@/server/db";
import { handler, json, readBody } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => json({ profile: await getProfile() }));

export const PUT = handler(async (req: Request) => {
	const input = await readBody(req, ProfileInputSchema);
	const trimmed = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v.trim()])) as typeof input;
	return json({ profile: await saveProfile(trimmed) });
});
