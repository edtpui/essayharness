import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeQuestions, sanitizePlan } from "@/server/essays";
import type { PlanResult } from "@/server/prompts";
import type { Question } from "@/lib/types";

const known = new Set(["exp_aaaaaaaaaaaa", "exp_bbbbbbbbbbbb"]);

const result = (overrides: Partial<PlanResult> = {}): PlanResult => ({
	assessment: "Strong material.",
	angles: [
		{ title: "Night shifts", pitch: "Responsibility.", experienceIds: ["exp_aaaaaaaaaaaa", "exp_zzzzzzzzzzzz"], outline: [{ beat: "Open at 2 a.m.", experienceIds: ["exp_zzzzzzzzzzzz"] }, { beat: " ", experienceIds: [] }] },
		{ title: "", pitch: "", experienceIds: [], outline: [] },
	],
	recommendedAngle: 7,
	gaps: [{ question: "  What did you say?  ", why: "Scene.", priority: "critical" }, { question: " ", why: "", priority: "helpful" }],
	ready: false,
	...overrides,
});

test("sanitizePlan drops unknown experience ids, empty angles and blank beats", () => {
	const plan = sanitizePlan(result(), known);
	assert.equal(plan.angles.length, 1);
	assert.deepEqual(plan.angles[0]!.experienceIds, ["exp_aaaaaaaaaaaa"]);
	assert.deepEqual(plan.angles[0]!.outline, [{ beat: "Open at 2 a.m.", experienceIds: [] }]);
	assert.equal(plan.recommendedAngle, 0, "out-of-range recommendation falls back to the first angle");
	assert.equal(plan.gaps.length, 1);
});

const existing: Question = {
	id: "q_aaaaaaaaaaaa",
	createdAt: "2026-11-01T00:00:00.000Z",
	question: "What did you say to your manager that night?",
	why: "",
	priority: "critical",
	status: "answered",
	entryId: "ent_aaaaaaaaaaaa",
	answeredAt: "2026-11-02T00:00:00.000Z",
};

test("mergeQuestions skips repeats and respects the cap", () => {
	const merged = mergeQuestions(
		[existing],
		[
			{ question: "What did you say to your manager that night?", why: "", priority: "critical" },
			{ question: "How many shifts did you cover each week?", why: "Evidence.", priority: "helpful" },
			{ question: "Why does pharmacy work interest you?", why: "Motivation.", priority: "helpful" },
		],
		1,
		"2026-11-24T00:00:00.000Z",
	);
	assert.equal(merged.length, 2);
	assert.equal(merged[1]!.question, "How many shifts did you cover each week?");
	assert.equal(merged[1]!.status, "open");
	assert.match(merged[1]!.id, /^q_[a-f0-9]{12}$/);
});
