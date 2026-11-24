import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { forceLayout } from "@/lib/force-layout";
import type { Entry, Essay, Experience } from "@/lib/types";
import { docxText, zipEntry } from "@/server/documents";
import { buildGraph } from "@/server/graph";

/** A minimal zip writer for test fixtures (method 8 = deflate, 0 = stored). */
function makeZip(files: Record<string, string>, method: 0 | 8 = 8): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const raw = Buffer.from(content, "utf8");
		const data = method === 8 ? deflateRawSync(raw) : raw;
		const nameBuf = Buffer.from(name, "utf8");
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, data);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const centralBuf = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBuf, end]);
}

const DOCUMENT_XML =
	'<?xml version="1.0"?><w:document><w:body>' +
	"<w:p><w:r><w:t>Night shifts &amp; calculus</w:t></w:r></w:p>" +
	'<w:p><w:r><w:t xml:space="preserve">I worked </w:t></w:r><w:r><w:t>three nights</w:t></w:r><w:r><w:br/><w:t>a week.</w:t></w:r></w:p>' +
	"<w:p><w:r><w:tab/><w:t>&#8220;Ask for help.&#x201D;</w:t></w:r></w:p>" +
	"</w:body></w:document>";

test("docx text keeps paragraphs, breaks, tabs and entities", () => {
	for (const method of [8, 0] as const) {
		const zip = makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": DOCUMENT_XML }, method);
		assert.equal(docxText(zip).trim(), "Night shifts & calculus\nI worked three nights\na week.\n\t“Ask for help.”");
	}
});

test("zipEntry returns null for a missing file and rejects non-zips", () => {
	assert.equal(zipEntry(makeZip({ "a.txt": "x" }), "word/document.xml"), null);
	assert.throws(() => docxText(Buffer.from("not a zip at all, just some text padding padding")), /couldn't be read/);
});

const exp = (id: string, title: string, skills: string[], people: string[] = []): Experience => ({
	id,
	title,
	category: "work",
	timeframe: "",
	summary: `${title} summary`,
	role: "",
	details: "",
	actions: "",
	outcomes: "",
	reflections: "",
	skills,
	people,
	quotes: [],
	sourceEntryIds: [],
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z",
});

test("the graph links shared qualities and people, essays and documents", () => {
	const experiences = [
		exp("exp_aaaaaaaaaaaa", "Night shifts", ["Resilience", "responsibility"], ["my mom"]),
		exp("exp_bbbbbbbbbbbb", "Robotics captain", ["resilience ", "leadership"], ["My mom"]),
		exp("exp_cccccccccccc", "Tutoring", ["patience"]),
	];
	const essay = {
		id: "ess_aaaaaaaaaaaa",
		title: "Award essay",
		scholarship: "",
		selectedAngle: 0,
		versions: [],
		questions: [],
		plan: { angles: [{ title: "A", pitch: "", experienceIds: ["exp_aaaaaaaaaaaa", "exp_gone00000000"], outline: [{ beat: "b", experienceIds: ["exp_bbbbbbbbbbbb"] }] }] },
	} as unknown as Essay;
	const upload = {
		id: "ent_aaaaaaaaaaaa",
		source: "import",
		title: "old-essay.docx",
		createdAt: "2026-11-01T00:00:00.000Z",
		extraction: { experienceIds: ["exp_cccccccccccc"] },
		review: null,
	} as unknown as Entry;
	const graph = buildGraph(experiences, [essay], [upload]);
	const ids = graph.nodes.map((n) => n.id);
	assert.ok(ids.includes("skill:resilience"), "shared quality, case and spacing ignored");
	assert.ok(!ids.includes("skill:patience"), "a quality only one experience shows is not a node");
	assert.ok(ids.includes("person:my mom"));
	const edge = (s: string, t: string) => graph.edges.some((e) => e.source === s && e.target === t);
	assert.ok(edge("exp_aaaaaaaaaaaa", "skill:resilience") && edge("exp_bbbbbbbbbbbb", "skill:resilience"));
	assert.ok(edge("ess_aaaaaaaaaaaa", "exp_aaaaaaaaaaaa") && edge("ess_aaaaaaaaaaaa", "exp_bbbbbbbbbbbb"));
	assert.ok(!graph.edges.some((e) => e.target === "exp_gone00000000"), "unknown experiences are not linked");
	assert.ok(edge("ent_aaaaaaaaaaaa", "exp_cccccccccccc"));
});

test("force layout is deterministic, finite, and pulls linked nodes together", () => {
	const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
	const edges = Array.from({ length: 19 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
	const a = forceLayout(ids, edges);
	const b = forceLayout(ids, edges);
	assert.deepEqual([...a.entries()], [...b.entries()]);
	for (const p of a.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
	const dist = (x: string, y: string) => Math.hypot(a.get(x)!.x - a.get(y)!.x, a.get(x)!.y - a.get(y)!.y);
	const linked = edges.reduce((sum, e) => sum + dist(e.source, e.target), 0) / edges.length;
	let all = 0;
	let pairs = 0;
	for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) (all += dist(ids[i]!, ids[j]!)), pairs++;
	assert.ok(linked < (all / pairs) * 0.6, `linked ${linked.toFixed(1)} vs average ${(all / pairs).toFixed(1)}`);
	assert.equal(forceLayout([], []).size, 0);
});
