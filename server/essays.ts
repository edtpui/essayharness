import {
	EssaySchema,
	QuestionSchema,
	VersionSchema,
	type Angle,
	type Entry,
	type Essay,
	type EssayBriefInput,
	type Experience,
	type Question,
	type Version,
} from "@/lib/types";
import { countCharacters, countWords, measure, similarity, truncate } from "@/lib/text";
import { entries, essays, experiences, getProfile, getSettings } from "./db";
import { HttpError } from "./errors";
import { generateObject, resolveModel, streamText } from "./llm";
import {
	AUDIT_SYSTEM,
	AuditResultSchema,
	PlanResultSchema,
	auditPrompt,
	draftPrompt,
	draftSystem,
	planPrompt,
	planSystem,
	revisePrompt,
	tightenInstruction,
	type PlanResult,
} from "./prompts";
import {
	byCreated,
	renderAngle,
	renderAnswers,
	renderBank,
	renderBrief,
	renderPreviousQuestions,
	renderProfile,
	renderVoiceSamples,
	type AnswerPair,
	type VoiceSample,
} from "./context";
import { withRun, type RunKind } from "./runs";
import { assertId, newId, nowIso } from "./store";

/* ---------- briefs ---------- */

export async function createEssay(input: EssayBriefInput): Promise<Essay> {
	const now = nowIso();
	const essay = EssaySchema.parse({ ...trimBrief(input), id: newId("ess"), createdAt: now, updatedAt: now });
	await essays.put(essay);
	return essay;
}

export function updateBrief(id: string, input: EssayBriefInput): Promise<Essay> {
	assertId(id);
	return essays.update(id, "Essay", (e) => ({ ...e, ...trimBrief(input), updatedAt: nowIso() }));
}

function trimBrief(input: EssayBriefInput): EssayBriefInput {
	return {
		title: input.title.trim(),
		scholarship: input.scholarship.trim(),
		prompt: input.prompt.trim(),
		limit: input.limit,
		criteria: input.criteria.trim(),
		notes: input.notes.trim(),
	};
}

export async function deleteEssay(id: string): Promise<void> {
	assertId(id);
	await essays.require(id, "Essay");
	await essays.remove(id);
	// Answers stay in the bank as ordinary notes.
	for (const entry of await entries.list()) {
		if (entry.essayId !== id) continue;
		await entries.update(entry.id, "Note", (e) => ({ ...e, essayId: null, questionId: null }));
	}
}

export function selectAngle(id: string, index: number): Promise<Essay> {
	assertId(id);
	return essays.update(id, "Essay", (e) => {
		if (!e.plan || index < 0 || index >= e.plan.angles.length) throw new HttpError(400, "No such angle");
		return { ...e, selectedAngle: index, updatedAt: nowIso() };
	});
}

export function setQuestionStatus(id: string, questionId: string, status: "open" | "skipped"): Promise<Essay> {
	assertId(id);
	return essays.update(id, "Essay", (e) => {
		const question = e.questions.find((q) => q.id === questionId);
		if (!question) throw new HttpError(404, "Question not found");
		if (question.status === "answered") throw new HttpError(409, "That question is answered. Delete the answer from Capture to reopen it.");
		return { ...e, updatedAt: nowIso(), questions: e.questions.map((q) => (q.id === questionId ? { ...q, status } : q)) };
	});
}

/* ---------- material ---------- */

interface Material {
	essay: Essay;
	bank: Experience[];
	answers: AnswerPair[];
	answerEntries: Entry[];
	allEntries: Entry[];
}

async function loadMaterial(id: string): Promise<Material> {
	assertId(id);
	const essay = await essays.require(id, "Essay");
	const [bank, allEntries] = await Promise.all([experiences.list(), entries.list()]);
	const byId = new Map(allEntries.map((e) => [e.id, e]));
	const answers: AnswerPair[] = [];
	const answerEntries: Entry[] = [];
	for (const q of essay.questions) {
		const entry = q.status === "answered" && q.entryId ? byId.get(q.entryId) : undefined;
		if (!entry) continue;
		answers.push({ question: q.question, answer: entry.text });
		answerEntries.push(entry);
	}
	return { essay, bank: byCreated(bank), answers, answerEntries, allEntries };
}

export function currentAngle(essay: Essay): Angle | null {
	return essay.plan?.angles[essay.selectedAngle] ?? essay.plan?.angles[0] ?? null;
}

/** The experiences a draft is built from: the chosen angle's, plus anything
 *  extracted from this essay's answers (which the plan predates). */
function selectedExperiences(m: Material, angle: Angle | null): Experience[] {
	if (!angle) return m.bank;
	const ids = new Set([...angle.experienceIds, ...angle.outline.flatMap((b) => b.experienceIds)]);
	for (const entry of m.answerEntries) for (const expId of entry.extraction.experienceIds) ids.add(expId);
	const chosen = m.bank.filter((e) => ids.has(e.id));
	return chosen.length ? chosen : m.bank;
}

const VOICE_BUDGET = 9000;

function voiceSamples(m: Material, chosen: Experience[]): VoiceSample[] {
	const samples: VoiceSample[] = [];
	let used = 0;
	const push = (label: string, text: string, cap: number) => {
		if (used >= VOICE_BUDGET) return;
		const piece = truncate(text, Math.min(cap, VOICE_BUDGET - used));
		used += piece.length;
		samples.push({ label, text: piece });
	};
	const newestFirst = [...m.allEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	for (const entry of newestFirst.filter((e) => e.writingSample).slice(0, 3)) push(`Writing sample: ${entry.title || entry.createdAt.slice(0, 10)}`, entry.text, 2500);
	const sourceIds = new Set(chosen.flatMap((e) => e.sourceEntryIds));
	const spoken = newestFirst.filter((e) => sourceIds.has(e.id) && !e.writingSample && e.source !== "import" && !m.answerEntries.includes(e));
	for (const entry of spoken.slice(0, 4)) push(`Note from ${entry.createdAt.slice(0, 10)}`, entry.text, 1500);
	return samples;
}

/** The cacheable part of a drafting request: most stable material first. */
async function draftContext(m: Material, chosen: Experience[]): Promise<string> {
	const profile = await getProfile();
	return [
		renderProfile(profile),
		renderBank(chosen).text,
		renderVoiceSamples(voiceSamples(m, chosen)),
		renderBrief(m.essay),
		renderAnswers(m.answers),
	]
		.filter(Boolean)
		.join("\n\n");
}

/* ---------- plan ---------- */

export function sanitizePlan(result: PlanResult, knownIds: Set<string>): PlanResult {
	const keep = (ids: string[]) => [...new Set(ids.filter((id) => knownIds.has(id)))];
	const angles = result.angles
		.filter((a) => a.title.trim() || a.pitch.trim())
		.slice(0, 4)
		.map((a) => ({
			title: a.title.trim() || "Untitled angle",
			pitch: a.pitch.trim(),
			experienceIds: keep(a.experienceIds),
			outline: a.outline.filter((b) => b.beat.trim()).map((b) => ({ beat: b.beat.trim(), experienceIds: keep(b.experienceIds) })),
		}));
	const recommended = Number.isInteger(result.recommendedAngle) && result.recommendedAngle >= 0 && result.recommendedAngle < angles.length ? result.recommendedAngle : 0;
	return { ...result, angles, recommendedAngle: recommended, gaps: result.gaps.filter((gap) => gap.question.trim()) };
}

/** Adds new gap questions, skipping any that repeat one already asked. */
export function mergeQuestions(existing: Question[], gaps: PlanResult["gaps"], max: number, now: string): Question[] {
	const out = [...existing];
	let added = 0;
	for (const gap of gaps) {
		if (added >= max) break;
		const text = gap.question.trim();
		if (out.some((q) => similarity(q.question, text) >= 0.7)) continue;
		out.push(
			QuestionSchema.parse({
				id: newId("q"),
				createdAt: now,
				question: text,
				why: gap.why.trim(),
				priority: gap.priority,
				status: "open",
			}),
		);
		added++;
	}
	return out;
}

export async function planEssay(id: string): Promise<Essay> {
	return withRun(id, "plan", async (signal) => {
		const m = await loadMaterial(id);
		if (!m.bank.length && !m.answers.length) {
			throw new HttpError(400, "Your experience bank is empty. Capture a few experiences first so there is something to plan from.");
		}
		const [settings, profile, ref] = await Promise.all([getSettings(), getProfile(), resolveModel("main")]);
		const context = [
			renderProfile(profile),
			renderBank(m.bank).text,
			renderBrief(m.essay),
			renderAnswers(m.answers),
			renderPreviousQuestions(m.essay.questions),
		]
			.filter(Boolean)
			.join("\n\n");
		const { object, model } = await generateObject(
			ref,
			{
				task: "plan",
				essayId: id,
				system: planSystem(settings.maxQuestions),
				context,
				prompt: planPrompt(),
				effort: "high",
				maxTokens: 16000,
				signal,
			},
			{ name: "essay_plan", schema: PlanResultSchema },
		);
		const plan = sanitizePlan(object, new Set(m.bank.map((e) => e.id)));
		if (!plan.angles.length) throw new HttpError(502, "The model returned no usable angle. Try planning again.");
		const now = nowIso();
		return essays.update(id, "Essay", (e) => ({
			...e,
			updatedAt: now,
			plan: {
				createdAt: now,
				model,
				assessment: plan.assessment.trim(),
				angles: plan.angles,
				recommendedAngle: plan.recommendedAngle,
				ready: plan.ready,
			},
			selectedAngle: plan.recommendedAngle,
			questions: mergeQuestions(e.questions, plan.gaps, settings.maxQuestions, now),
		}));
	});
}

/* ---------- draft, revise, tighten ---------- */

export interface GenerateInput {
	mode: "draft" | "revise" | "tighten";
	instruction?: string;
	baseVersionId?: string;
}

export async function generateVersion(id: string, input: GenerateInput, onDelta: (text: string) => void): Promise<Version> {
	const kind: RunKind = input.mode;
	return withRun(id, kind, async (signal) => {
		const m = await loadMaterial(id);
		const angle = currentAngle(m.essay);
		const chosen = selectedExperiences(m, angle);
		if (!chosen.length && !m.answers.length) throw new HttpError(400, "There is no material to write from yet. Capture some experiences first.");

		let prompt: string;
		let instruction = "";
		if (input.mode === "draft") {
			prompt = draftPrompt(renderAngle(angle));
		} else {
			const base = input.baseVersionId ? m.essay.versions.find((v) => v.id === input.baseVersionId) : m.essay.versions.at(-1);
			if (!base) throw new HttpError(400, "There is no draft to revise yet.");
			if (input.mode === "revise") {
				instruction = input.instruction?.trim() ?? "";
				if (!instruction) throw new HttpError(400, "Say what to change.");
			} else {
				const limit = m.essay.limit;
				if (!limit) throw new HttpError(400, "This essay has no length limit to cut to.");
				const { count, over } = measure(base.text, limit);
				if (!over) throw new HttpError(400, "This draft is already within the limit.");
				instruction = tightenInstruction(count, limit);
			}
			prompt = `${renderAngle(angle)}\n\n${revisePrompt(base.text, instruction)}`;
		}

		const ref = await resolveModel("main");
		const { text, model } = await streamText(
			ref,
			{
				task: input.mode === "draft" ? "draft" : input.mode,
				essayId: id,
				system: draftSystem(m.essay.limit),
				context: await draftContext(m, chosen),
				prompt,
				effort: "high",
				maxTokens: 32000,
				signal,
			},
			onDelta,
		);
		if (!text.trim()) throw new HttpError(502, "The model returned an empty draft. Try again.");

		const version = VersionSchema.parse({
			id: newId("v"),
			createdAt: nowIso(),
			kind: input.mode === "draft" ? "draft" : input.mode === "revise" ? "revision" : "tighten",
			text: text.trim(),
			words: countWords(text),
			characters: countCharacters(text.trim()),
			model,
			instruction: input.mode === "revise" ? instruction : "",
			angle: angle?.title ?? "",
		});
		await essays.update(id, "Essay", (e) => ({ ...e, updatedAt: version.createdAt, versions: [...e.versions, version] }));
		return version;
	});
}

export async function saveManualVersion(id: string, text: string): Promise<Essay> {
	assertId(id);
	const body = text.trim();
	if (!body) throw new HttpError(400, "The draft can't be empty.");
	return essays.update(id, "Essay", (e) => {
		const latest = e.versions.at(-1);
		if (latest && latest.text === body) return e;
		const version = VersionSchema.parse({
			id: newId("v"),
			createdAt: nowIso(),
			kind: "manual",
			text: body,
			words: countWords(body),
			characters: countCharacters(body),
			angle: latest?.angle ?? "",
		});
		return { ...e, updatedAt: version.createdAt, versions: [...e.versions, version] };
	});
}

/* ---------- fact check ---------- */

export async function auditEssay(id: string, versionId?: string): Promise<Essay> {
	return withRun(id, "audit", async (signal) => {
		const m = await loadMaterial(id);
		const version = versionId ? m.essay.versions.find((v) => v.id === versionId) : m.essay.versions.at(-1);
		if (!version) throw new HttpError(400, "There is no draft to check yet.");
		const ref = await resolveModel("main");
		const profile = await getProfile();
		// Check against everything the applicant has said, not only the chosen angle's material.
		const context = [renderProfile(profile), renderBank(m.bank).text, renderVoiceSamples(voiceSamples(m, m.bank)), renderAnswers(m.answers)]
			.filter(Boolean)
			.join("\n\n");
		const { object, model } = await generateObject(
			ref,
			{
				task: "audit",
				essayId: id,
				system: AUDIT_SYSTEM,
				context,
				prompt: auditPrompt(version.text),
				effort: "high",
				maxTokens: 16000,
				signal,
			},
			{ name: "fact_check", schema: AuditResultSchema },
		);
		const issues = object.issues
			.filter((i) => i.excerpt.trim())
			.map((i) => ({ ...i, excerpt: i.excerpt.trim(), explanation: i.explanation.trim(), suggestion: i.suggestion.trim() }));
		return essays.update(id, "Essay", (e) => ({
			...e,
			audit: { versionId: version.id, createdAt: nowIso(), model, summary: object.summary.trim(), issues },
		}));
	});
}
