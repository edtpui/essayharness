import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ThinkTagFilter, extractJsonObject, strictJsonSchema, stripThinking } from "@/server/llm/shared";

test("ThinkTagFilter removes think blocks split across chunks", () => {
	const filter = new ThinkTagFilter();
	const chunks = ["<thi", "nk>planning the ", "essay</th", "ink>\n\nThe first", " line.<", "br>"];
	const out = chunks.map((c) => filter.push(c)).join("") + filter.flush();
	assert.equal(out, "\n\nThe first line.<br>");
});

test("ThinkTagFilter passes text with no think tags through unchanged", () => {
	const filter = new ThinkTagFilter();
	const out = ["I think ", "<b>this</b> ", "is fine <thin"].map((c) => filter.push(c)).join("") + filter.flush();
	assert.equal(out, "I think <b>this</b> is fine <thin");
});

test("ThinkTagFilter drops an unterminated think block", () => {
	assert.equal(stripThinking("Answer <think>never closed"), "Answer");
});

test("extractJsonObject handles fences, prose and think blocks", () => {
	assert.deepEqual(extractJsonObject('<think>hmm</think>Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
	assert.deepEqual(extractJsonObject('Sure. {"b": [1, 2]} Done.'), { b: [1, 2] });
	assert.throws(() => extractJsonObject("no json here"), /no JSON object/);
});

test("strictJsonSchema requires every property and forbids extras", () => {
	const schema = strictJsonSchema(
		z.object({
			name: z.string().min(1),
			count: z.number().int(),
			items: z.array(z.object({ label: z.string(), score: z.number().max(10).optional() })),
		}),
	);
	assert.equal(schema.$schema, undefined);
	assert.deepEqual(schema.required, ["name", "count", "items"]);
	assert.equal(schema.additionalProperties, false);
	const props = schema.properties as Record<string, any>;
	assert.equal(props.name.minLength, undefined);
	assert.equal(props.count.minimum, undefined);
	assert.deepEqual(props.items.items.required, ["label", "score"]);
	assert.equal(props.items.items.additionalProperties, false);
});
