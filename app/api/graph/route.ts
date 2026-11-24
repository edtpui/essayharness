import { entries, essays, experiences } from "@/server/db";
import { buildGraph } from "@/server/graph";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
	const [exps, essayList, entryList] = await Promise.all([experiences.list(), essays.list(), entries.list()]);
	return json({ graph: buildGraph(exps, essayList, entryList) });
});
