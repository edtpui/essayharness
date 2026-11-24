import { z } from "zod";
import { CREDENTIALS } from "@/lib/types";
import { credentialStatuses, setCredential } from "@/server/db";
import { handler, json, readBody } from "@/server/http";

const KeyInput = z.object({
	name: z.enum(CREDENTIALS),
	key: z.string().trim().max(2000).nullable(),
});

export const PUT = handler(async (req: Request) => {
	const { name, key } = await readBody(req, KeyInput);
	await setCredential(name, key);
	return json({ credentials: await credentialStatuses() });
});
