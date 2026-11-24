import assert from "node:assert/strict";
import { test } from "node:test";
import { appendField, experienceFromOperation, isEmptyOperation, mergeOperation, uniqueList, type ExtractOperation } from "@/server/bank";

const op = (overrides: Partial<ExtractOperation> = {}): ExtractOperation => ({
	action: "create",
	experienceId: "",
	title: "Covered night shifts at the pharmacy",
	category: "work",
	timeframe: "Grade 12",
	summary: "I worked night shifts while my mom was sick.",
	role: "Pharmacy assistant",
	details: "The pharmacy was short-staffed.",
	actions: "I covered three night shifts a week.",
	outcomes: "",
	reflections: "",
	skills: ["Responsibility", "time management"],
	people: ["my mom"],
	quotes: ["I learned to study at 2 a.m."],
	...overrides,
});

test("a create operation becomes a complete experience linked to its note", () => {
	const exp = experienceFromOperation(op(), "ent_aaaaaaaaaaaa", "2026-11-24T00:00:00.000Z");
	assert.match(exp.id, /^exp_[a-f0-9]{12}$/);
	assert.equal(exp.title, "Covered night shifts at the pharmacy");
	assert.deepEqual(exp.sourceEntryIds, ["ent_aaaaaaaaaaaa"]);
	assert.equal(exp.createdAt, "2026-11-24T00:00:00.000Z");
});

test("an untitled operation gets a title from its summary", () => {
	const exp = experienceFromOperation(op({ title: "  " }), "ent_aaaaaaaaaaaa", "2026-11-24T00:00:00.000Z");
	assert.equal(exp.title, "I worked night shifts while my mom was sick.");
});

test("merging keeps existing identity fields, appends narrative and unions lists", () => {
	const current = experienceFromOperation(op(), "ent_aaaaaaaaaaaa", "2026-11-01T00:00:00.000Z");
	const merged = mergeOperation(
		current,
		op({
			action: "update",
			experienceId: current.id,
			title: "Different title",
			timeframe: "2025",
			summary: "I worked night shifts while my mom was sick and still made honour roll.",
			details: "The pharmacy was short-staffed.", // already present: not repeated
			outcomes: "I made the honour roll that term.",
			skills: ["responsibility", "Resilience"],
			quotes: ["I learned to study at 2 a.m.", "Nobody else was going to do it."],
		}),
		"ent_bbbbbbbbbbbb",
		"2026-11-24T00:00:00.000Z",
	);
	assert.equal(merged.title, "Covered night shifts at the pharmacy");
	assert.equal(merged.timeframe, "Grade 12");
	assert.equal(merged.summary, "I worked night shifts while my mom was sick and still made honour roll.");
	assert.equal(merged.details, "The pharmacy was short-staffed.");
	assert.equal(merged.outcomes, "I made the honour roll that term.");
	assert.deepEqual(merged.skills, ["Responsibility", "time management", "Resilience"]);
	assert.deepEqual(merged.quotes, ["I learned to study at 2 a.m.", "Nobody else was going to do it."]);
	assert.deepEqual(merged.sourceEntryIds, ["ent_aaaaaaaaaaaa", "ent_bbbbbbbbbbbb"]);
	assert.equal(merged.createdAt, "2026-11-01T00:00:00.000Z");
	assert.equal(merged.updatedAt, "2026-11-24T00:00:00.000Z");
});

test("an update with an empty summary keeps the old one", () => {
	const current = experienceFromOperation(op(), "ent_aaaaaaaaaaaa", "2026-11-01T00:00:00.000Z");
	const merged = mergeOperation(current, op({ action: "update", summary: "" }), "ent_aaaaaaaaaaaa", "2026-11-24T00:00:00.000Z");
	assert.equal(merged.summary, current.summary);
	assert.deepEqual(merged.sourceEntryIds, ["ent_aaaaaaaaaaaa"]);
});

test("appendField skips text the field already contains", () => {
	assert.equal(appendField("", "New."), "New.");
	assert.equal(appendField("Old.", "New."), "Old.\n\nNew.");
	assert.equal(appendField("I covered three shifts.", "i covered THREE shifts"), "I covered three shifts.");
	assert.equal(appendField("Old.", "   "), "Old.");
});

test("uniqueList trims, drops blanks and duplicates case-insensitively, and caps", () => {
	assert.deepEqual(uniqueList([" a ", "A", "", "b", "c"], 2), ["a", "b"]);
});

test("an operation with no content is empty", () => {
	assert.ok(isEmptyOperation(op({ title: "", summary: "", details: "", actions: "", outcomes: "", reflections: "" })));
	assert.ok(!isEmptyOperation(op()));
});
