import type { Entry } from "@/lib/types";
import { extractEntry } from "./bank";
import { renderNote } from "./context";
import { entries } from "./db";
import { HttpError, errorMessage } from "./errors";
import { generateObject, resolveModel } from "./llm";
import { REVIEW_SYSTEM, ReviewResultSchema, reviewPrompt } from "./prompts";
import { assertId, nowIso, withLock } from "./store";

const g = globalThis as typeof globalThis & { __seReviewing?: Set<string> };
const reviewing: Set<string> = (g.__seReviewing ??= new Set());

export function isReviewing(id: string): boolean {
	return reviewing.has(id);
}

/** Reviews an uploaded document. Like sorting, a model failure is recorded on the note, not thrown. */
export async function reviewEntry(id: string): Promise<Entry> {
	assertId(id);
	if (reviewing.has(id)) throw new HttpError(409, "This document is already being reviewed.");
	reviewing.add(id);
	try {
		// One review at a time keeps a batch upload from flooding a local model.
		return await withLock("review", async () => {
			const entry = await entries.update(id, "Note", (e) => ({ ...e, review: { ...(e.review ?? emptyReview()), status: "running" as const, error: "" } }));
			try {
				const ref = await resolveModel("extraction");
				const { object, model } = await generateObject(
					ref,
					{ task: "review", system: REVIEW_SYSTEM, context: renderNote(entry), prompt: reviewPrompt(), effort: "medium", maxTokens: 12000 },
					{ name: "document_review", schema: ReviewResultSchema },
				);
				const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean).slice(0, 6);
				return await entries.update(id, "Note", (e) => ({
					...e,
					review: {
						status: "done" as const,
						error: "",
						kind: object.kind,
						summary: object.summary.trim(),
						strengths: clean(object.strengths),
						weaknesses: clean(object.weaknesses),
						suggestions: clean(object.suggestions),
						goodFor: clean(object.goodFor),
						at: nowIso(),
						model,
					},
				}));
			} catch (err) {
				console.error(`[review] ${id}:`, errorMessage(err));
				return await entries.update(id, "Note", (e) => ({
					...e,
					review: { ...(e.review ?? emptyReview()), status: "failed" as const, error: errorMessage(err), at: nowIso() },
				}));
			}
		});
	} finally {
		reviewing.delete(id);
	}
}

export function emptyReview() {
	return { status: "pending" as const, error: "", kind: "other" as const, summary: "", strengths: [], weaknesses: [], suggestions: [], goodFor: [], at: "", model: "" };
}

/** Background work for an upload: add it to the bank, then review it. Runs after the request returns. */
export function processUpload(id: string): void {
	void (async () => {
		try {
			await extractEntry(id);
		} catch (err) {
			console.error(`[upload] sorting ${id}:`, errorMessage(err));
		}
		try {
			await reviewEntry(id);
		} catch (err) {
			console.error(`[upload] reviewing ${id}:`, errorMessage(err));
		}
	})();
}
