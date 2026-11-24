import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createEntry, deleteEntry, extractEntry } from "@/server/bank";
import { entries, essays, experiences, saveSettings } from "@/server/db";
import { HttpError, LlmError } from "@/server/errors";
import { auditEssay, createEssay, generateVersion, planEssay, saveManualVersion, selectAngle } from "@/server/essays";
import { generateInterview } from "@/server/interview";
import { stopRun } from "@/server/runs";
import { usageSummary } from "@/server/usage";
import { chatCompletion, chatStream, startFakeLlm, userText, type Captured, type FakeServer, type Reply } from "./helpers/fake-llm";
import { useTempDataDir } from "./helpers/temp-data";

/* The whole capture → plan → answer → draft → revise → check path, through the
 * real OpenAI-compatible adapter, against a scripted local model. */

let server: FakeServer;
let cleanup: () => Promise<void>;
let draftDelay = 0;

function scripted(req: Captured): Reply {
	const name: string | undefined = req.body?.response_format?.json_schema?.name;
	const user = userText(req);
	const reply = (value: unknown) => ({ json: chatCompletion(JSON.stringify(value)) });
	if (name === "extraction") {
		const note = /<note[^>]*>\n(?:<question>[\s\S]*?<\/question>\n)?([\s\S]*?)\n<\/note>/.exec(user)?.[1] ?? "";
		return reply({
			operations: [
				{
					action: "create",
					experienceId: "",
					title: note.split(/\s+/).slice(0, 5).join(" "),
					category: "work",
					timeframe: "",
					summary: note.slice(0, 80),
					role: "",
					details: note,
					actions: "",
					outcomes: "",
					reflections: "",
					skills: ["grit"],
					people: [],
					quotes: [],
				},
			],
		});
	}
	if (name === "essay_plan") {
		const ids = [...user.matchAll(/\[(exp_[a-f0-9]{12})\]/g)].map((m) => m[1]!);
		return reply({
			assessment: "Good material on responsibility.",
			angles: [
				{ title: "Night shifts", pitch: "Responsibility under pressure.", experienceIds: ids.slice(0, 1), outline: [{ beat: "Open at the counter", experienceIds: ids.slice(0, 1) }] },
				{ title: "Family first", pitch: "Care as a choice.", experienceIds: ids, outline: [] },
			],
			recommendedAngle: 0,
			gaps: [{ question: "What did you say to your manager when you offered to cover?", why: "A concrete scene.", priority: "critical" }],
			ready: false,
		});
	}
	if (name === "fact_check") {
		const draft = /<draft>\n([\s\S]*?)\n<\/draft>/.exec(user)?.[1] ?? "";
		return reply({
			summary: "One claim to check.",
			issues: [{ excerpt: draft.split(/\s+/).slice(0, 3).join(" "), problem: "unsupported", explanation: "Not in your notes.", suggestion: "Cut it." }],
		});
	}
	if (name === "chat_turn") {
		const latest = /Applicant \(latest\): ([\s\S]*?)\n<\/conversation_history>/.exec(user)?.[1] ?? "";
		const openQuestion = /<open_questions>\n\[(q_[a-f0-9]{12})\]/.exec(user)?.[1];
		const turn = (action: string, instruction = "", saveAsNote = false, answeredQuestionIds: string[] = []) =>
			reply({ reply: `Reply to: ${latest.slice(0, 30)}`, action, instruction, saveAsNote, answeredQuestionIds });
		if (/^plan/i.test(latest)) return turn("plan");
		if (/^write/i.test(latest)) return turn("draft", "Use the Saturday detail.");
		if (/shorter/i.test(latest)) return turn("revise", "Make it shorter.");
		return turn("none", "", true, openQuestion ? [openQuestion] : []);
	}
	if (name === "document_review") {
		return reply({
			kind: "essay",
			summary: "An essay about night shifts.",
			strengths: ["A concrete 2 a.m. scene"],
			weaknesses: ["The ending is generic"],
			suggestions: ["End on what changed"],
			goodFor: ["a challenge you overcame"],
		});
	}
	if (name === "interview_questions") {
		return reply({ questions: [{ question: "Who taught you the most about work?", theme: "Influences", why: "Common prompt." }] });
	}
	if (req.body?.stream) {
		const revision = user.includes("<revision_request>");
		return { delayMs: draftDelay, sse: chatStream(["<think>outline first</think>", revision ? "Revised: " : "", "I covered night ", "shifts at the pharmacy."]) };
	}
	return { status: 400, json: { error: { message: `unexpected request ${req.path}` } } };
}

before(async () => {
	({ cleanup } = await useTempDataDir());
	server = await startFakeLlm(scripted);
	await saveSettings({ mainModel: { provider: "custom", model: "fake-model" }, customBaseUrl: `${server.url}/v1`, maxQuestions: 4 });
});

after(async () => {
	await server.close();
	await cleanup();
});

let essayId = "";
let questionId = "";
let answerId = "";

test("a dictated note is saved first, then sorted into the bank", async () => {
	const entry = await createEntry({ text: "I covered night shifts at the pharmacy while my mom was sick.", source: "dictation" });
	assert.equal(entry.extraction.status, "pending");
	const { entry: sorted, experiences: made } = await extractEntry(entry.id);
	assert.equal(sorted.extraction.status, "done");
	assert.equal(made.length, 1);
	assert.equal(made[0]!.title, "I covered night shifts at");
	assert.deepEqual(made[0]!.sourceEntryIds, [entry.id]);
});

test("sorting failures leave the note saved and retryable", async () => {
	const original = scripted;
	server.respond(() => ({ status: 503, json: { error: { message: "model loading" } } }));
	try {
		const entry = await createEntry({ text: "A second story about the robotics club.", source: "typed" });
		const { entry: failed } = await extractEntry(entry.id);
		assert.equal(failed.extraction.status, "failed");
		assert.match(failed.extraction.error, /Fake local|custom endpoint|error/i);
		server.respond(original);
		const { entry: retried } = await extractEntry(entry.id);
		assert.equal(retried.extraction.status, "done");
	} finally {
		server.respond(original);
	}
});

test("planning proposes angles and asks about the gaps", async () => {
	const essay = await createEssay({
		title: "Responsibility essay",
		scholarship: "Test Foundation",
		prompt: "Tell us about a time you took responsibility.",
		limit: { unit: "words", value: 8 },
		criteria: "Leadership, service",
		notes: "",
	});
	essayId = essay.id;
	const planned = await planEssay(essayId);
	assert.ok(planned.plan);
	assert.equal(planned.plan.angles.length, 2);
	assert.equal(planned.selectedAngle, 0);
	assert.equal(planned.plan.angles[0]!.experienceIds.length, 1);
	assert.equal(planned.questions.length, 1);
	assert.equal(planned.questions[0]!.status, "open");
	questionId = planned.questions[0]!.id;

	const planCall = server.calls.findLast((c) => c.body?.response_format?.json_schema?.name === "essay_plan")!;
	const context = userText(planCall);
	assert.match(context, /<essay_brief>[\s\S]*Tell us about a time you took responsibility/);
	assert.match(context, /<experience_bank count="2">/);
});

test("answering a question links the note and the answer reaches the next plan", async () => {
	const answer = await createEntry({ text: "I told her I would cover every Friday until mom was better.", source: "interview", essayId, questionId });
	answerId = answer.id;
	assert.equal(answer.prompt, "What did you say to your manager when you offered to cover?");
	await extractEntry(answer.id);
	let essay = (await essays.get(essayId))!;
	assert.equal(essay.questions[0]!.status, "answered");
	assert.equal(essay.questions[0]!.entryId, answer.id);

	essay = await planEssay(essayId);
	assert.equal(essay.questions.length, 1, "the repeated gap question is not added again");
	const planCall = server.calls.findLast((c) => c.body?.response_format?.json_schema?.name === "essay_plan")!;
	assert.match(userText(planCall), /<answers[\s\S]*cover every Friday/);
	assert.match(userText(planCall), /\(answered\) What did you say/);
});

test("drafting streams the essay, strips hidden thinking and saves a version", async () => {
	const deltas: string[] = [];
	const version = await generateVersion(essayId, { mode: "draft" }, (d) => deltas.push(d));
	assert.equal(version.text, "I covered night shifts at the pharmacy.");
	assert.equal(deltas.join(""), version.text);
	assert.equal(version.words, 7);
	assert.equal(version.kind, "draft");
	assert.equal(version.angle, "Night shifts");

	const call = server.calls.findLast((c) => c.body?.stream)!;
	assert.match(call.body.messages[0].content, /The limit is 8 words/);
	const material = userText(call);
	assert.match(material, /<chosen_angle>[\s\S]*Night shifts/);
	assert.match(material, /cover every Friday/, "answers are part of the draft material");
	assert.match(material, /<profile>/);
});

test("revising sends the draft and the request, and saves a new version", async () => {
	const version = await generateVersion(essayId, { mode: "revise", instruction: "Open with the counter." }, () => undefined);
	assert.equal(version.kind, "revision");
	assert.equal(version.instruction, "Open with the counter.");
	assert.equal(version.text, "Revised: I covered night shifts at the pharmacy.");
	const material = userText(server.calls.findLast((c) => c.body?.stream)!);
	assert.match(material, /<current_draft>\nI covered night shifts at the pharmacy.\n<\/current_draft>/);
	assert.match(material, /<revision_request>\nOpen with the counter.\n<\/revision_request>/);
	assert.equal((await essays.get(essayId))!.versions.length, 2);
});

test("revise and tighten refuse when there is nothing to do", async () => {
	await assert.rejects(generateVersion(essayId, { mode: "revise", instruction: "  " }, () => undefined), HttpError);
	await assert.rejects(generateVersion(essayId, { mode: "tighten" }, () => undefined), /already within the limit/);
});

test("only one run per essay at a time, and Stop aborts without saving", async () => {
	draftDelay = 400;
	try {
		const first = generateVersion(essayId, { mode: "draft" }, () => undefined);
		await new Promise((r) => setTimeout(r, 50));
		await assert.rejects(generateVersion(essayId, { mode: "draft" }, () => undefined), (err: unknown) => err instanceof HttpError && err.status === 409);
		assert.equal(stopRun(essayId), true);
		await assert.rejects(first, (err: unknown) => err instanceof LlmError && err.kind === "aborted");
	} finally {
		draftDelay = 0;
	}
	assert.equal((await essays.get(essayId))!.versions.length, 2);
	assert.equal(stopRun(essayId), false);
});

test("the fact check stores issues for the version it checked", async () => {
	const essay = await auditEssay(essayId);
	assert.ok(essay.audit);
	assert.equal(essay.audit.versionId, essay.versions.at(-1)!.id);
	assert.equal(essay.audit.issues.length, 1);
	assert.equal(essay.audit.issues[0]!.excerpt, "Revised: I covered");
});

test("a manual edit becomes a version; identical text does not", async () => {
	let essay = await saveManualVersion(essayId, "  My own words here.  ");
	assert.equal(essay.versions.at(-1)!.kind, "manual");
	assert.equal(essay.versions.at(-1)!.text, "My own words here.");
	essay = await saveManualVersion(essayId, "My own words here.");
	assert.equal(essay.versions.length, 3);
});

test("switching angles is validated", async () => {
	assert.equal((await selectAngle(essayId, 1)).selectedAngle, 1);
	await assert.rejects(selectAngle(essayId, 5), HttpError);
});

test("deleting an answer reopens its question and unlinks experiences", async () => {
	const linked = (await experiences.list()).filter((e) => e.sourceEntryIds.includes(answerId));
	assert.ok(linked.length > 0);
	await deleteEntry(answerId);
	const essay = (await essays.get(essayId))!;
	assert.equal(essay.questions[0]!.status, "open");
	assert.equal(essay.questions[0]!.entryId, null);
	for (const exp of await experiences.list()) assert.ok(!exp.sourceEntryIds.includes(answerId));
});

test("the bank interview stores new questions without repeats", async () => {
	const first = await generateInterview(3);
	assert.equal(first.questions.length, 1);
	const second = await generateInterview(3);
	assert.equal(second.questions.length, 1, "the same question is not stored twice");
});

test("usage is recorded for every model call", async () => {
	const usage = await usageSummary();
	assert.ok(usage.calls >= 8, String(usage.calls));
	assert.equal(usage.totalCostUsd, 0, "non-Anthropic calls are not priced");
	assert.ok(usage.byTask.plan && usage.byTask.draft && usage.byTask.extract);
});

test("chat: a conversation plans, keeps new facts, drafts from them and revises", async () => {
	const { chatTurn } = await import("@/server/chat");
	const essay = await createEssay({ title: "Chat essay", scholarship: "", prompt: "Why do you deserve this award?", limit: null, criteria: "", notes: "" });
	const events: string[] = [];
	const deltas: string[] = [];
	const emit = (e: { type: string; text?: string }) => {
		events.push(e.type);
		if (e.type === "delta" && e.text) deltas.push(e.text);
	};

	let state = await chatTurn(essay.id, "Plan this essay please", emit);
	assert.ok(state.plan, "plan action ran");
	assert.equal(state.messages.length, 3, "user, reply, plan summary");
	assert.equal(state.messages[1]!.action, "plan");
	assert.match(state.messages[2]!.text, /To write it well, tell me:\n1\. /);
	const questionId = state.questions.find((q) => q.status === "open")!.id;

	state = await chatTurn(essay.id, "I also said I would cover Saturdays during exams.", emit);
	const userMsg = state.messages.at(-2)!;
	assert.equal(userMsg.role, "user");
	assert.ok(userMsg.entryId, "the new fact was saved to the bank as a note");
	const note = await entries.get(userMsg.entryId!);
	assert.equal(note?.source, "chat");
	assert.equal(note?.text, "I also said I would cover Saturdays during exams.");
	const answered = state.questions.find((q) => q.id === questionId)!;
	assert.equal(answered.status, "answered");
	assert.equal(answered.entryId, userMsg.entryId);
	assert.equal(state.versions.length, 0, "adding a fact does not rewrite anything by itself");

	state = await chatTurn(essay.id, "Write the draft now", emit);
	assert.equal(state.versions.length, 1);
	assert.equal(state.messages.at(-1)!.versionId, state.versions[0]!.id);
	assert.equal(state.versions[0]!.instruction, "Use the Saturday detail.");
	assert.ok(deltas.length > 0, "the draft streamed");
	const draftCall = server.calls.findLast((c) => c.body?.stream)!;
	assert.match(userText(draftCall), /<conversation[^>]*>[\s\S]*cover Saturdays during exams/, "the chat is drafting material");

	state = await chatTurn(essay.id, "Make it a bit shorter", emit);
	assert.equal(state.versions.length, 2);
	assert.equal(state.versions[1]!.kind, "revision");
	assert.match(userText(server.calls.findLast((c) => c.body?.stream)!), /<current_draft>/);

	const turnCall = server.calls.findLast((c) => c.body?.response_format?.json_schema?.name === "chat_turn")!;
	assert.match(userText(turnCall), /<current_draft version="1"/, "the coach sees the current draft");
	assert.match(userText(turnCall), /Applicant \(latest\): Make it a bit shorter/);
	assert.ok(events.includes("version") && events.includes("essay"));
});

test("chat: the message is saved even when the model call fails", async () => {
	const { chatTurn } = await import("@/server/chat");
	const essay = await createEssay({ title: "Failing", scholarship: "", prompt: "Prompt", limit: null, criteria: "", notes: "" });
	const original = scripted;
	server.respond(() => ({ status: 503, json: { error: { message: "down" } } }));
	try {
		await assert.rejects(chatTurn(essay.id, "This story must not be lost.", () => undefined));
	} finally {
		server.respond(original);
	}
	const saved = (await essays.get(essay.id))!;
	assert.equal(saved.messages.length, 1);
	assert.equal(saved.messages[0]!.text, "This story must not be lost.");
});

test("an upload is added to the bank and reviewed in the background", async () => {
	const { processUpload } = await import("@/server/uploads");
	const entry = await createEntry({ text: "At 2 a.m. I did calculus in the pharmacy back room.", source: "import", title: "old-essay.docx", writingSample: true });
	processUpload(entry.id);
	let current = await entries.get(entry.id);
	for (let i = 0; i < 100 && current?.review?.status !== "done"; i++) {
		await new Promise((r) => setTimeout(r, 20));
		current = await entries.get(entry.id);
	}
	assert.equal(current?.extraction.status, "done");
	assert.equal(current?.extraction.experienceIds.length, 1);
	assert.equal(current?.review?.status, "done");
	assert.equal(current?.review?.kind, "essay");
	assert.deepEqual(current?.review?.weaknesses, ["The ending is generic"]);
	const reviewCall = server.calls.findLast((c) => c.body?.response_format?.json_schema?.name === "document_review")!;
	assert.match(userText(reviewCall), /<note source="import"[^>]*title="old-essay.docx"/);
});
