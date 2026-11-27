import { exportBank } from "@/server/bank";
import { handler } from "@/server/http";

export const dynamic = "force-dynamic";

/** Downloads the whole experience bank (profile, notes, experiences) as one
 *  JSON file. Essays, settings, and API keys are not part of the bank. */
export const GET = handler(async () => {
	const bundle = await exportBank();
	const stamp = bundle.exportedAt.slice(0, 10);
	return new Response(JSON.stringify(bundle, null, 2), {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename="essayharness-bank-${stamp}.json"`,
			"Cache-Control": "no-store",
		},
	});
});
