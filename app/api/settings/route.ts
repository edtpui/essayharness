import { SettingsInputSchema, type SettingsView } from "@/lib/types";
import { credentialStatuses, getSettings, saveSettings } from "@/server/db";
import { handler, json, readBody } from "@/server/http";
import { dataDir } from "@/server/store";

export const dynamic = "force-dynamic";

async function view(): Promise<SettingsView> {
	const [settings, credentials] = await Promise.all([getSettings(), credentialStatuses()]);
	return { settings, credentials, dataDir: dataDir() };
}

export const GET = handler(async () => json(await view()));

export const PUT = handler(async (req: Request) => {
	const input = await readBody(req, SettingsInputSchema);
	await saveSettings(input);
	return json(await view());
});
