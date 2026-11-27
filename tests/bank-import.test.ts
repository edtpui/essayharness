import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BankExportSchema,
	EntrySchema,
	ExperienceSchema,
	type BankExport,
	type Entry,
	type Experience,
} from "@/lib/types";
import { planBankImport } from "@/server/bank";

const NOW = "2026-11-27T00:00:00.000Z";

const entry = (overrides: Partial<Entry> = {}): Entry =>
	EntrySchema.parse({
		id: "ent_aaaaaaaaaaaa",
		createdAt: NOW,
		updatedAt: NOW,
		source: "typed",
		text: "I ran the robotics club's outreach day.",
		extraction: { status: "done", experienceIds: ["exp_bbbbbbbbbbbb"] },
		...overrides,
	});

const experience = (overrides: Partial<Experience> = {}): Experience =>
	ExperienceSchema.parse({
		id: "exp_bbbbbbbbbbbb",
		title: "Ran the outreach day",
		category: "leadership",
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	});

const bundle = (overrides: Partial<BankExport> = {}): BankExport =>
	BankExportSchema.parse({
		app: "essayharness",
		kind: "experience-bank",
		version: 1,
		exportedAt: NOW,
		entries: [entry()],
		experiences: [experience()],
		...overrides,
	});

const empty = { entryIds: new Set<string>(), experienceIds: new Set<string>() };

test("a fresh bank imports everything", () => {
	const plan = planBankImport(bundle(), empty);
	assert.equal(plan.entriesToAdd.length, 1);
	assert.equal(plan.experiencesToAdd.length, 1);
	assert.equal(plan.entriesSkipped, 0);
	assert.equal(plan.experiencesSkipped, 0);
});

test("items already here are skipped, by id", () => {
	const plan = planBankImport(bundle(), {
		entryIds: new Set(["ent_aaaaaaaaaaaa"]),
		experienceIds: new Set(["exp_bbbbbbbbbbbb"]),
	});
	assert.equal(plan.entriesToAdd.length, 0);
	assert.equal(plan.experiencesToAdd.length, 0);
	assert.equal(plan.entriesSkipped, 1);
	assert.equal(plan.experiencesSkipped, 1);
});

test("duplicates inside the file itself are added once", () => {
	const plan = planBankImport(bundle({ entries: [entry(), entry()], experiences: [experience(), experience()] }), empty);
	assert.equal(plan.entriesToAdd.length, 1);
	assert.equal(plan.experiencesToAdd.length, 1);
	assert.equal(plan.entriesSkipped, 1);
	assert.equal(plan.experiencesSkipped, 1);
});

test("ids the store cannot write are skipped, not fatal", () => {
	const plan = planBankImport(bundle({ entries: [entry({ id: "not-an-app-id" })] }), empty);
	assert.equal(plan.entriesToAdd.length, 0);
	assert.equal(plan.entriesSkipped, 1);
});

test("imported notes are cut loose from the other install's essays and interview", () => {
	const linked = entry({ essayId: "ess_cccccccccccc", questionId: "q1", interviewQuestionId: "iq1" });
	const plan = planBankImport(bundle({ entries: [linked] }), empty);
	const added = plan.entriesToAdd[0];
	assert.ok(added);
	assert.equal(added.essayId, null);
	assert.equal(added.questionId, null);
	assert.equal(added.interviewQuestionId, null);
});

test("a note caught mid-sort goes back to pending; a finished one is untouched", () => {
	const running = entry({ extraction: { status: "running", error: "", experienceIds: [], at: "", model: "" } });
	const plan = planBankImport(bundle({ entries: [running] }), empty);
	const added = plan.entriesToAdd[0];
	assert.ok(added);
	assert.equal(added.extraction.status, "pending");

	const done = planBankImport(bundle(), empty);
	const doneAdded = done.entriesToAdd[0];
	assert.ok(doneAdded);
	assert.equal(doneAdded.extraction.status, "done");
	assert.deepEqual(doneAdded.extraction.experienceIds, ["exp_bbbbbbbbbbbb"]);
});

test("experiences pass through unchanged, source links included", () => {
	const exp = experience({ sourceEntryIds: ["ent_aaaaaaaaaaaa"] });
	const plan = planBankImport(bundle({ experiences: [exp] }), empty);
	assert.deepEqual(plan.experiencesToAdd[0], exp);
});
