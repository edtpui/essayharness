import assert from "node:assert/strict";
import { test } from "node:test";
import { appendText, countCharacters, countWords, deepgramListenUrl, measure, similarity, truncate } from "@/lib/text";

test("countWords counts whitespace tokens that contain a letter or digit", () => {
	assert.equal(countWords(""), 0);
	assert.equal(countWords("   "), 0);
	assert.equal(countWords("I organised the drive."), 4);
	assert.equal(countWords("well-being isn't one — word"), 4);
	assert.equal(countWords("Line one\n\nLine two"), 4);
	assert.equal(countWords("2024 was hard"), 3);
});

test("countCharacters counts code points including spaces", () => {
	assert.equal(countCharacters("abc def"), 7);
	assert.equal(countCharacters("é"), 1);
	assert.equal(countCharacters("👍🏽"), 2);
});

test("measure reports the limit's unit and overage", () => {
	assert.deepEqual(measure("one two three", { unit: "words", value: 2 }), { count: 3, unit: "words", over: true });
	assert.deepEqual(measure("abc", { unit: "characters", value: 3 }), { count: 3, unit: "characters", over: false });
	assert.deepEqual(measure("one two", null), { count: 2, unit: "words", over: false });
});

test("appendText joins dictated phrases with one space", () => {
	assert.equal(appendText("", "  Hello. "), "Hello.");
	assert.equal(appendText("Hello.", "World."), "Hello. World.");
	assert.equal(appendText("Hello.\n", "World."), "Hello.\nWorld.");
	assert.equal(appendText("Hello.", "   "), "Hello.");
});

test("similarity is high for near-identical questions and low for different ones", () => {
	assert.ok(similarity("What did you say to your manager?", "What did you say to your manager that night?") >= 0.7);
	assert.ok(similarity("How many students came?", "Why did you choose engineering?") < 0.3);
	assert.equal(similarity("", "anything"), 0);
});

test("truncate cuts at a word boundary", () => {
	assert.equal(truncate("short", 10), "short");
	assert.equal(truncate("the quick brown fox jumps", 12), "the quick…");
});

test("deepgramListenUrl encodes language and sample rate", () => {
	const url = new URL(deepgramListenUrl("en-GB", 48000));
	assert.equal(url.searchParams.get("language"), "en-GB");
	assert.equal(url.searchParams.get("sample_rate"), "48000");
	assert.equal(url.searchParams.get("encoding"), "linear16");
	assert.equal(url.searchParams.get("interim_results"), "true");
});
