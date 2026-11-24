import type { Entry, Essay, Experience, GraphData, GraphEdge, GraphNode } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { truncate } from "@/lib/text";
import { currentAngle } from "./essays";

/* The experience graph: experiences linked through the qualities and people
 * they share, the essays that draw on them, and the documents they came from.
 * A quality or person appears only when two or more experiences share it, so
 * the graph shows connections rather than every tag. */

function key(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sharedNodes(
	experiences: Experience[],
	pick: (e: Experience) => string[],
	kind: "skill" | "person",
	minShared: number,
	nodes: GraphNode[],
	edges: GraphEdge[],
) {
	const groups = new Map<string, { label: string; ids: Set<string> }>();
	for (const exp of experiences) {
		for (const raw of pick(exp)) {
			const k = key(raw);
			if (!k) continue;
			const group = groups.get(k) ?? { label: raw.trim(), ids: new Set<string>() };
			group.ids.add(exp.id);
			groups.set(k, group);
		}
	}
	for (const [k, group] of groups) {
		if (group.ids.size < minShared) continue;
		const id = `${kind}:${k}`;
		nodes.push({ id, kind, label: group.label, detail: `${kind === "skill" ? "Shown in" : "Appears in"} ${group.ids.size} experiences` });
		for (const expId of group.ids) edges.push({ source: expId, target: id, kind: kind === "skill" ? "shows" : "involves" });
	}
}

export function buildGraph(experiences: Experience[], essays: Essay[], entries: Entry[], minShared = 2): GraphData {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const known = new Set(experiences.map((e) => e.id));

	for (const exp of experiences) {
		nodes.push({
			id: exp.id,
			kind: "experience",
			label: exp.title,
			category: exp.category,
			detail: [CATEGORY_LABELS[exp.category], exp.timeframe, exp.summary].filter(Boolean).join(" · "),
			href: `/bank#${exp.id}`,
		});
	}
	sharedNodes(experiences, (e) => e.skills, "skill", minShared, nodes, edges);
	sharedNodes(experiences, (e) => e.people, "person", minShared, nodes, edges);

	const entryById = new Map(entries.map((e) => [e.id, e]));
	for (const essay of essays) {
		const used = new Set<string>();
		const angle = currentAngle(essay);
		for (const id of [...(angle?.experienceIds ?? []), ...(angle?.outline.flatMap((b) => b.experienceIds) ?? [])]) used.add(id);
		for (const q of essay.questions) {
			const entry = q.entryId ? entryById.get(q.entryId) : undefined;
			for (const id of entry?.extraction.experienceIds ?? []) used.add(id);
		}
		const linked = [...used].filter((id) => known.has(id));
		nodes.push({
			id: essay.id,
			kind: "essay",
			label: essay.title,
			detail: [essay.scholarship, angle ? `Angle: ${angle.title}` : "Not planned yet", `${essay.versions.length} draft version${essay.versions.length === 1 ? "" : "s"}`]
				.filter(Boolean)
				.join(" · "),
			href: `/essays/${essay.id}`,
		});
		for (const id of linked) edges.push({ source: essay.id, target: id, kind: "uses" });
	}

	for (const entry of entries) {
		if (entry.source !== "import") continue;
		const linked = entry.extraction.experienceIds.filter((id) => known.has(id));
		nodes.push({
			id: entry.id,
			kind: "document",
			label: entry.title || "Uploaded document",
			detail: entry.review?.status === "done" ? truncate(entry.review.summary, 240) : `Uploaded ${entry.createdAt.slice(0, 10)}`,
			href: "/",
		});
		for (const id of linked) edges.push({ source: entry.id, target: id, kind: "from" });
	}
	return { nodes, edges };
}
