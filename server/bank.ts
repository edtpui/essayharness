import {
	EntrySchema,
	ExperienceSchema,
	type BankExport,
	type BankImportResult,
	type Entry,
	type EntrySource,
	type Experience,
	type ExperienceInput,
} from "@/lib/types";
import { normalizeForMatch, truncate } from "@/lib/text";
import { entries, essays, experiences, getInterview, getProfile, saveProfile, updateInterview } from "./db";
import { HttpError, errorMessage } from "./errors";
import { generateObject, resolveModel } from "./llm";
import { EXTRACT_SYSTEM, ExtractResultSchema, extractPrompt, type ExtractResult } from "./prompts";
import { byCreated, renderBankIndex, renderNote } from "./context";
import { assertId, newId, nowIso, withLock } from "./store";

export type ExtractOperation = ExtractResult["operations"][number];

const MAX_NOTE_CHARS = 80_000;

/* ---------- merge rules (pure, unit-tested) ---------- */

function clean(value: string): string {
	return value.replace(/\s+\n/g, "\n").trim();
}

export function uniqueList(values: string[], max = 50): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of values) {
		const value = raw.trim();
		const key = value.toLowerCase();
		if (!value || seen.has(key)) continue;
		seen.add(key);
		out.push(value);
		if (out.length >= max) break;
	}
	return out;
}

/** Appends new text to a field unless the field already says it. */
export function appendField(current: string, addition: string): string {
	const add = clean(addition);
	if (!add) return current;
	if (normalizeForMatch(current).includes(normalizeForMatch(add))) return current;
	return current.trim() ? `${current.trim()}\n\n${add}` : add;
}

export function isEmptyOperation(op: ExtractOperation): boolean {
	return ![op.title, op.summary, op.details, op.actions, op.outcomes, op.reflections].some((v) => v.trim());
}

export function experienceFromOperation(op: ExtractOperation, entryId: string, now: string): Experience {
	const title = clean(op.title) || truncate(clean(op.summary) || clean(op.details), 80) || "Untitled experience";
	return ExperienceSchema.parse({
		id: newId("exp"),
		title,
		category: op.category,
		timeframe: clean(op.timeframe),
		summary: clean(op.summary),
		role: clean(op.role),
		details: clean(op.details),
		actions: clean(op.actions),
		outcomes: clean(op.outcomes),
		reflections: clean(op.reflections),
		skills: uniqueList(op.skills, 20),
		people: uniqueList(op.people, 20),
		quotes: uniqueList(op.quotes, 6),
		sourceEntryIds: [entryId],
		createdAt: now,
		updatedAt: now,
	});
}

/** Merges an update into an existing experience without losing what's there:
 *  identity fields only fill blanks, narrative fields append, lists union. */
export function mergeOperation(current: Experience, op: ExtractOperation, entryId: string, now: string): Experience {
	return {
		...current,
		title: current.title.trim() ? current.title : clean(op.title) || current.title,
		timeframe: current.timeframe.trim() ? current.timeframe : clean(op.timeframe),
		role: current.role.trim() ? current.role : clean(op.role),
		summary: clean(op.summary) || current.summary,
		details: appendField(current.details, op.details),
		actions: appendField(current.actions, op.actions),
		outcomes: appendField(current.outcomes, op.outcomes),
		reflections: appendField(current.reflections, op.reflections),
		skills: uniqueList([...current.skills, ...op.skills], 30),
		people: uniqueList([...current.people, ...op.people], 30),
		quotes: uniqueList([...current.quotes, ...op.quotes], 12),
		sourceEntryIds: uniqueList([...current.sourceEntryIds, entryId], 500),
		updatedAt: now,
	};
}

async function applyOperations(entryId: string, operations: ExtractOperation[], known: Set<string>): Promise<Experience[]> {
	const touched = new Map<string, Experience>();
	const now = nowIso();
	for (const op of operations) {
		if (op.action === "update" && known.has(op.experienceId)) {
			try {
				// Re-read under the record lock so a concurrent manual edit is merged into, not overwritten.
				const updated = await experiences.update(op.experienceId, "Experience", (cur) => mergeOperation(cur, op, entryId, now));
				touched.set(updated.id, updated);
				continue;
			} catch (err) {
				if (!(err instanceof HttpError && err.status === 404)) throw err;
				// Deleted meanwhile: keep the information as a new experience.
			}
		}
		if (isEmptyOperation(op)) continue;
		const created = experienceFromOperation(op, entryId, now);
		await experiences.put(created);
		touched.set(created.id, created);
	}
	return [...touched.values()];
}

/* ---------- notes ---------- */

export interface NewEntryInput {
	text: string;
	source: EntrySource;
	title?: string;
	prompt?: string;
	essayId?: string | null;
	questionId?: string | null;
	interviewQuestionId?: string | null;
	writingSample?: boolean;
}

export async function createEntry(input: NewEntryInput): Promise<Entry> {
	const text = input.text.trim();
	if (!text) throw new HttpError(400, "There's nothing to save yet.");
	if (text.length > MAX_NOTE_CHARS) {
		throw new HttpError(413, `That note is ${text.length.toLocaleString()} characters; the limit is ${MAX_NOTE_CHARS.toLocaleString()}. Split it into parts.`);
	}

	let prompt = input.prompt?.trim() ?? "";
	if (input.essayId) {
		assertId(input.essayId);
		const essay = await essays.require(input.essayId, "Essay");
		if (input.questionId) {
			const question = essay.questions.find((q) => q.id === input.questionId);
			if (!question) throw new HttpError(404, "Question not found");
			prompt ||= question.question;
		}
	}
	if (input.interviewQuestionId) {
		const question = (await getInterview()).questions.find((q) => q.id === input.interviewQuestionId);
		if (!question) throw new HttpError(404, "Interview question not found");
		prompt ||= question.question;
	}

	const now = nowIso();
	const entry: Entry = EntrySchema.parse({
		id: newId("ent"),
		createdAt: now,
		updatedAt: now,
		source: input.source,
		title: input.title?.trim() ?? "",
		prompt,
		text,
		essayId: input.essayId ?? null,
		questionId: input.essayId ? (input.questionId ?? null) : null,
		interviewQuestionId: input.interviewQuestionId ?? null,
		writingSample: input.writingSample ?? false,
		extraction: { status: "pending" },
	});
	await entries.put(entry);

	if (input.essayId && input.questionId) {
		await essays.update(input.essayId, "Essay", (e) => ({
			...e,
			updatedAt: now,
			questions: e.questions.map((q) =>
				q.id === input.questionId ? { ...q, status: "answered" as const, entryId: entry.id, answeredAt: now } : q,
			),
		}));
	}
	if (input.interviewQuestionId) {
		await updateInterview((iv) => ({
			...iv,
			questions: iv.questions.map((q) =>
				q.id === input.interviewQuestionId ? { ...q, status: "answered" as const, entryId: entry.id } : q,
			),
		}));
	}
	return entry;
}

const g = globalThis as typeof globalThis & { __seExtracting?: Set<string> };
const extracting: Set<string> = (g.__seExtracting ??= new Set());

/** Sorts one note into the bank. Never throws for a model failure: the note
 *  stays saved with status "failed" and the reason, so it can be retried. */
export async function extractEntry(id: string): Promise<{ entry: Entry; experiences: Experience[] }> {
	assertId(id);
	if (extracting.has(id)) throw new HttpError(409, "This note is already being sorted.");
	extracting.add(id);
	try {
		// One extraction at a time: concurrent ones can't see each other's new experiences and would duplicate them.
		return await withLock("extraction", async () => {
			const entry = await entries.update(id, "Note", (e) => ({ ...e, extraction: { ...e.extraction, status: "running", error: "" } }));
			try {
				const ref = await resolveModel("extraction");
				const bank = byCreated(await experiences.list());
				const { object, model } = await generateObject(
					ref,
					{
						task: "extract",
						essayId: entry.essayId,
						system: EXTRACT_SYSTEM,
						context: `${renderBankIndex(bank)}\n\n${renderNote(entry)}`,
						prompt: extractPrompt(),
						effort: "medium",
						maxTokens: 16000,
					},
					{ name: "extraction", schema: ExtractResultSchema },
				);
				const touched = await applyOperations(entry.id, object.operations, new Set(bank.map((e) => e.id)));
				const done = await entries.update(id, "Note", (e) => ({
					...e,
					extraction: { status: "done", error: "", experienceIds: touched.map((x) => x.id), at: nowIso(), model },
				}));
				return { entry: done, experiences: touched };
			} catch (err) {
				console.error(`[extract] ${id}:`, errorMessage(err));
				const failed = await entries.update(id, "Note", (e) => ({
					...e,
					extraction: { ...e.extraction, status: "failed", error: errorMessage(err), at: nowIso() },
				}));
				return { entry: failed, experiences: [] };
			}
		});
	} finally {
		extracting.delete(id);
	}
}

export function isExtracting(id: string): boolean {
	return extracting.has(id);
}

export async function updateEntry(id: string, patch: { text?: string; writingSample?: boolean }): Promise<Entry> {
	assertId(id);
	if (isExtracting(id)) throw new HttpError(409, "Wait until this note has been sorted.");
	return entries.update(id, "Note", (e) => {
		const text = patch.text?.trim();
		if (patch.text !== undefined && !text) throw new HttpError(400, "A note can't be empty. Delete it instead.");
		if (text && text.length > MAX_NOTE_CHARS) throw new HttpError(413, `Notes are limited to ${MAX_NOTE_CHARS.toLocaleString()} characters.`);
		const changed = text !== undefined && text !== e.text;
		return {
			...e,
			text: text ?? e.text,
			writingSample: patch.writingSample ?? e.writingSample,
			updatedAt: nowIso(),
			// Edited text needs sorting again; the bank keeps what was already extracted.
			extraction: changed ? { ...e.extraction, status: "pending" as const, error: "" } : e.extraction,
		};
	});
}

/** Deletes a note. Experiences built from it stay (they may have been edited);
 *  they only lose the link. A question it answered becomes open again. */
export async function deleteEntry(id: string): Promise<void> {
	assertId(id);
	if (isExtracting(id)) throw new HttpError(409, "Wait until this note has been sorted.");
	const entry = await entries.require(id, "Note");
	await entries.remove(id);
	for (const exp of await experiences.list()) {
		if (!exp.sourceEntryIds.includes(id)) continue;
		await experiences.update(exp.id, "Experience", (e) => ({ ...e, sourceEntryIds: e.sourceEntryIds.filter((s) => s !== id) }));
	}
	if (entry.essayId && entry.questionId) {
		const essay = await essays.get(entry.essayId);
		if (essay) {
			await essays.update(essay.id, "Essay", (e) => ({
				...e,
				questions: e.questions.map((q) =>
					q.entryId === id ? { ...q, status: "open" as const, entryId: null, answeredAt: null } : q,
				),
			}));
		}
	}
	if (entry.interviewQuestionId) {
		await updateInterview((iv) => ({
			...iv,
			questions: iv.questions.map((q) => (q.entryId === id ? { ...q, status: "open" as const, entryId: null } : q)),
		}));
	}
}

/* ---------- experiences edited by hand ---------- */

export async function createExperience(input: ExperienceInput): Promise<Experience> {
	const now = nowIso();
	const exp = ExperienceSchema.parse({ ...normalizeInput(input), id: newId("exp"), sourceEntryIds: [], createdAt: now, updatedAt: now });
	await experiences.put(exp);
	return exp;
}

export function updateExperience(id: string, input: ExperienceInput): Promise<Experience> {
	assertId(id);
	return experiences.update(id, "Experience", (e) => ({ ...e, ...normalizeInput(input), updatedAt: nowIso() }));
}

export async function deleteExperience(id: string): Promise<void> {
	assertId(id);
	await experiences.require(id, "Experience");
	await experiences.remove(id);
}

function normalizeInput(input: ExperienceInput): ExperienceInput {
	return {
		...input,
		title: input.title.trim(),
		timeframe: input.timeframe.trim(),
		summary: input.summary.trim(),
		role: input.role.trim(),
		details: input.details.trim(),
		actions: input.actions.trim(),
		outcomes: input.outcomes.trim(),
		reflections: input.reflections.trim(),
		skills: uniqueList(input.skills),
		people: uniqueList(input.people),
		quotes: uniqueList(input.quotes, 30),
	};
}

/* ---------- bank export / import ---------- */

export interface BankImportPlan {
	entriesToAdd: Entry[];
	experiencesToAdd: Experience[];
	entriesSkipped: number;
	experiencesSkipped: number;
}

/** Same shape the store accepts (server/store.ts); anything else can never
 *  be written, so it counts as skipped rather than failing the import. */
const IMPORTABLE_ID = /^[a-z]{1,4}_[a-f0-9]{12}$/;

/** Decides what an imported bank adds: anything whose id is new here, so
 *  re-importing your own export changes nothing. Notes are cut loose from
 *  the exporting install's essays and interview (those ids mean nothing
 *  here), and a note caught mid-sort goes back to pending, since nothing
 *  will ever finish that run. Pure, unit-tested. */
export function planBankImport(bundle: BankExport, have: { entryIds: Set<string>; experienceIds: Set<string> }): BankImportPlan {
	const plan: BankImportPlan = { entriesToAdd: [], experiencesToAdd: [], entriesSkipped: 0, experiencesSkipped: 0 };
	const seenEntries = new Set<string>();
	for (const entry of bundle.entries) {
		if (!IMPORTABLE_ID.test(entry.id) || have.entryIds.has(entry.id) || seenEntries.has(entry.id)) {
			plan.entriesSkipped++;
			continue;
		}
		seenEntries.add(entry.id);
		plan.entriesToAdd.push({
			...entry,
			essayId: null,
			questionId: null,
			interviewQuestionId: null,
			extraction: entry.extraction.status === "running" ? { ...entry.extraction, status: "pending" as const } : entry.extraction,
		});
	}
	const seenExperiences = new Set<string>();
	for (const exp of bundle.experiences) {
		if (!IMPORTABLE_ID.test(exp.id) || have.experienceIds.has(exp.id) || seenExperiences.has(exp.id)) {
			plan.experiencesSkipped++;
			continue;
		}
		seenExperiences.add(exp.id);
		plan.experiencesToAdd.push(exp);
	}
	return plan;
}

export async function exportBank(): Promise<BankExport> {
	const [profile, entryList, experienceList] = await Promise.all([getProfile(), entries.list(), experiences.list()]);
	return {
		app: "essayharness",
		kind: "experience-bank",
		version: 1,
		exportedAt: nowIso(),
		profile,
		entries: byCreated(entryList),
		experiences: byCreated(experienceList),
	};
}

export async function importBank(bundle: BankExport): Promise<BankImportResult> {
	const [entryList, experienceList] = await Promise.all([entries.list(), experiences.list()]);
	const plan = planBankImport(bundle, {
		entryIds: new Set(entryList.map((e) => e.id)),
		experienceIds: new Set(experienceList.map((e) => e.id)),
	});
	for (const entry of plan.entriesToAdd) await entries.put(entry);
	for (const exp of plan.experiencesToAdd) await experiences.put(exp);

	// The profile only fills a blank "About you"; an import never overwrites
	// facts already entered on this install.
	let profileImported = false;
	if (bundle.profile) {
		const fieldsOf = (p: typeof bundle.profile) =>
			p ? [p.name, p.education, p.field, p.goals, p.location, p.other] : [];
		const current = await getProfile();
		const blankHere = fieldsOf(current).every((v) => !v.trim());
		const hasContent = fieldsOf(bundle.profile).some((v) => v.trim());
		if (blankHere && hasContent) {
			const { updatedAt: _ignored, ...fields } = bundle.profile;
			await saveProfile(fields);
			profileImported = true;
		}
	}
	return {
		entriesAdded: plan.entriesToAdd.length,
		entriesSkipped: plan.entriesSkipped,
		experiencesAdded: plan.experiencesToAdd.length,
		experiencesSkipped: plan.experiencesSkipped,
		profileImported,
	};
}
