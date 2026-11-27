import { BankExportSchema } from "@/lib/types";
import { importBank } from "@/server/bank";
import { handler, json, readBody } from "@/server/http";

export const dynamic = "force-dynamic";

/** Body: a bank file produced by GET /api/bank/export. Anything already
 *  here (same id) is skipped, so importing the same file twice changes
 *  nothing the second time. */
export const POST = handler(async (req: Request) => {
	const bundle = await readBody(req, BankExportSchema);
	return json({ result: await importBank(bundle) });
});
