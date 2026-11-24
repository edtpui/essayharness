import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { saveSettings } from "@/server/db";
import { LlmError } from "@/server/errors";
import { FALLBACK_BETA, anthropicObject, anthropicStream } from "@/server/llm/anthropic";
import { openaiObject, openaiStream } from "@/server/llm/openai";
import type { LlmRequest } from "@/server/llm/shared";
import { usageSummary } from "@/server/usage";
import { anthropicMessage, anthropicStream as anthropicSse, chatCompletion, chatStream, startFakeLlm, type FakeServer } from "./helpers/fake-llm";
import { useTempDataDir } from "./helpers/temp-data";

let server: FakeServer;
let cleanup: () => Promise<void>;

before(async () => {
	({ cleanup } = await useTempDataDir());
	server = await startFakeLlm(() => ({ status: 500, json: { error: { message: "no responder" } } }));
	process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000000000";
	process.env.ANTHROPIC_BASE_URL = server.url;
	await saveSettings({ customBaseUrl: `${server.url}/v1`, customName: "Fake local" });
});

after(async () => {
	await server.close();
	await cleanup();
});

const Schema = z.object({ title: z.string(), tags: z.array(z.string()) });
const req: LlmRequest = { task: "extract", system: "system text", context: "<bank>stable</bank>", prompt: "do the task", effort: "medium", maxTokens: 1000 };

const isKind = (kind: string) => (err: unknown) => err instanceof LlmError && err.kind === kind;

test("Anthropic: structured call sends fallbacks, effort, schema and a cached context block", async () => {
	server.respond(() => ({ json: anthropicMessage(JSON.stringify({ title: "T", tags: ["a"] })) }));
	const start = server.calls.length;
	const result = await anthropicObject("claude-opus-5-5", req, { name: "x", schema: Schema });
	assert.deepEqual(result.object, { title: "T", tags: ["a"] });
	assert.equal(result.model, "claude-opus-5-5");

	const call = server.calls[start]!;
	assert.ok(call.path.startsWith("/v1/messages"), call.path);
	assert.ok(String(call.headers["anthropic-beta"]).includes(FALLBACK_BETA));
	assert.equal(call.headers.authorization, "Bearer sk-ant-test-0000000000");
	assert.equal(call.body.model, "claude-opus-5-5");
	assert.equal(call.body.fallbacks, "default");
	assert.equal(call.body.output_config.effort, "medium");
	assert.equal(call.body.output_config.format.type, "json_schema");
	assert.equal(call.body.system, "system text");
	assert.deepEqual(call.body.messages[0].content[0], { type: "text", text: "<bank>stable</bank>", cache_control: { type: "ephemeral" } });
	assert.deepEqual(call.body.messages[0].content[1], { type: "text", text: "do the task" });
	for (const banned of ["temperature", "top_p", "top_k", "thinking", "betas"]) assert.equal(call.body[banned], undefined, banned);
});

test("Anthropic: models without effort support get no effort parameter", async () => {
	server.respond(() => ({ json: anthropicMessage(JSON.stringify({ title: "T", tags: [] })) }));
	const start = server.calls.length;
	await anthropicObject("claude-haiku-4-5", req, { name: "x", schema: Schema });
	assert.equal(server.calls[start]!.body.output_config.effort, undefined);
});

test("Anthropic: a refusal becomes a refusal error", async () => {
	server.respond(() => ({ json: anthropicMessage("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }) }));
	await assert.rejects(anthropicObject("claude-opus-5-5", req, { name: "x", schema: Schema }), (err: unknown) => isKind("refusal")(err) && /cyber/.test((err as Error).message));
});

test("Anthropic: hitting max_tokens is reported, not saved as a result", async () => {
	server.respond(() => ({ sse: anthropicSse(["Half an ess"], "max_tokens") }));
	await assert.rejects(anthropicStream("claude-opus-5-5", req, () => undefined), isKind("truncated"));
});

test("Anthropic: a bad key becomes an auth error", async () => {
	server.respond(() => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
	await assert.rejects(anthropicObject("claude-opus-5-5", req, { name: "x", schema: Schema }), isKind("auth"));
});

test("Anthropic: streaming delivers every delta and the joined final text", async () => {
	server.respond(() => ({ sse: anthropicSse(["I covered ", "night shifts", "."]) }));
	const deltas: string[] = [];
	const start = server.calls.length;
	const result = await anthropicStream("claude-opus-5-5", { ...req, task: "draft" }, (d) => deltas.push(d));
	assert.deepEqual(deltas, ["I covered ", "night shifts", "."]);
	assert.equal(result.text, "I covered night shifts.");
	assert.equal(server.calls[start]!.body.stream, true);
	assert.equal(server.calls[start]!.body.fallbacks, "default");
});

test("Anthropic usage is priced from list prices", async () => {
	const usage = await usageSummary();
	const draft = usage.recent.find((r) => r.task === "draft");
	assert.ok(draft);
	// 1200 in × $4 + 800 cache reads × $0.20 + 300 out × $20, per million tokens
	assert.ok(Math.abs((draft.costUsd ?? 0) - 0.01096) < 1e-9, String(draft.costUsd));
});

test("OpenAI-compatible: streaming hides think blocks and asks for usage", async () => {
	server.respond(() => ({ sse: chatStream(["<think>plan the", " essay</think>\n\n", "I covered ", "night shifts."]) }));
	const deltas: string[] = [];
	const start = server.calls.length;
	const result = await openaiStream("custom", "fake-model", { ...req, task: "draft" }, (d) => deltas.push(d));
	assert.equal(result.text, "I covered night shifts.");
	assert.equal(deltas.join(""), "I covered night shifts.");
	const call = server.calls[start]!;
	assert.ok(call.path.endsWith("/v1/chat/completions"), call.path);
	assert.equal(call.body.stream, true);
	assert.deepEqual(call.body.stream_options, { include_usage: true });
	assert.equal(call.body.messages[0].role, "system");
	assert.equal(call.body.messages[1].content, "<bank>stable</bank>\n\ndo the task");
});

test("OpenAI-compatible: retries without stream_options when the server rejects it", async () => {
	server.respond((r) =>
		r.body.stream_options ? { status: 400, json: { error: { message: "unknown field stream_options" } } } : { sse: chatStream(["Fine."], false) },
	);
	const result = await openaiStream("custom", "fake-model", req, () => undefined);
	assert.equal(result.text, "Fine.");
});

test("OpenAI-compatible: falls back from json_schema to JSON mode and reads fenced JSON", async () => {
	const formats: (string | undefined)[] = [];
	server.respond((r) => {
		formats.push(r.body.response_format?.type);
		if (r.body.response_format?.type === "json_schema") return { status: 400, json: { error: { message: "response_format json_schema not supported" } } };
		return { json: chatCompletion('<think>x</think>```json\n{"title": "T", "tags": ["a"]}\n```') };
	});
	const result = await openaiObject("custom", "fake-model", req, { name: "x", schema: Schema });
	assert.deepEqual(result.object, { title: "T", tags: ["a"] });
	assert.deepEqual(formats, ["json_schema", "json_object"]);
	const system = server.calls.at(-1)!.body.messages[0].content as string;
	assert.match(system, /JSON Schema/);
});

test("OpenAI-compatible: one repair attempt fixes a malformed reply", async () => {
	let n = 0;
	server.respond(() => ({ json: chatCompletion(n++ === 0 ? '{"title": 5}' : '{"title": "Fixed", "tags": []}') }));
	const start = server.calls.length;
	const result = await openaiObject("custom", "fake-model", req, { name: "x", schema: Schema });
	assert.deepEqual(result.object, { title: "Fixed", tags: [] });
	const repair = server.calls[start + 1]!.body.messages;
	assert.equal(repair.at(-2).role, "assistant");
	assert.match(repair.at(-1).content, /not valid/);
});

test("OpenAI-compatible: a reply that stays malformed is an invalid-output error", async () => {
	server.respond(() => ({ json: chatCompletion("not json at all") }));
	await assert.rejects(openaiObject("custom", "fake-model", req, { name: "x", schema: Schema }), isKind("invalid_output"));
});

test("OpenAI-compatible: an unreachable endpoint names the URL", async () => {
	await saveSettings({ customBaseUrl: "http://127.0.0.1:9/v1" });
	try {
		await assert.rejects(openaiStream("custom", "fake-model", req, () => undefined), (err: unknown) => isKind("connection")(err) && /127\.0\.0\.1:9/.test((err as Error).message));
	} finally {
		await saveSettings({ customBaseUrl: `${server.url}/v1` });
	}
});

test("OpenAI: a missing key is a configuration error", async () => {
	delete process.env.OPENAI_API_KEY;
	await assert.rejects(openaiStream("openai", "gpt-x", req, () => undefined), isKind("config"));
});
