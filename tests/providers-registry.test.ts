import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PROVIDER_LIST, credentialEnvVar, isProviderId, providerInfo } from "@/lib/providers";
import { saveSettings } from "@/server/db";
import { LlmError } from "@/server/errors";
import { openaiObject, openaiStream } from "@/server/llm/openai";
import type { LlmRequest } from "@/server/llm/shared";
import { planSystem } from "@/server/prompts";
import { SettingsSchema } from "@/lib/types";
import { z } from "zod";
import { startFakeLlm, type FakeServer } from "./helpers/fake-llm";
import { useTempDataDir } from "./helpers/temp-data";

/** The API-key providers this app supports (the pi-ai 1.5.2 set), minus Radius (its own protocol) and TypeSafe (no models). */
const EXPECTED_PROVIDERS = [
	"ant-ling", "anthropic", "baseten", "cerebras", "deepseek", "fireworks", "google", "groq", "huggingface", "kimi-coding", "meta",
	"minimax", "minimax-cn", "mistral", "moonshotai", "moonshotai-cn", "nvidia", "openai", "opencode", "opencode-go", "openrouter",
	"qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual", "qwen-token-plan-individual-cn", "together",
	"vercel-ai-gateway", "xai", "xiaomi", "xiaomi-token-plan-ams", "xiaomi-token-plan-cn", "xiaomi-token-plan-sgp", "zai", "zai-coding-cn",
];

test("every supported API-key provider is available, with an https endpoint and an env var", () => {
	for (const id of EXPECTED_PROVIDERS) {
		assert.ok(isProviderId(id), id);
		const info = providerInfo(id)!;
		assert.match(info.baseURL, /^https:\/\//, id);
		assert.match(info.envVar, /^[A-Z][A-Z0-9_]+$/, id);
	}
	assert.equal(new Set(PROVIDER_LIST.map((p) => p.id)).size, PROVIDER_LIST.length, "ids are unique");
	assert.equal(credentialEnvVar("google"), "GEMINI_API_KEY");
	assert.equal(credentialEnvVar("huggingface"), "HF_TOKEN");
	assert.equal(credentialEnvVar("deepgram"), "DEEPGRAM_API_KEY");
	assert.ok(!isProviderId("nope"));
});

test("settings accept any registered provider and a blank question limit", () => {
	const s = SettingsSchema.parse({ mainModel: { provider: "openrouter", model: "x" }, maxQuestions: null });
	assert.equal(s.maxQuestions, null);
	assert.equal(SettingsSchema.parse({}).maxQuestions, 6, "existing default is kept");
	assert.throws(() => SettingsSchema.parse({ mainModel: { provider: "nope", model: "x" } }));
});

test("the plan prompt caps questions only when a limit is set", () => {
	assert.match(planSystem(4), /Ask at most 4 questions/);
	const open = planSystem(null);
	assert.match(open, /as many questions as the essay genuinely needs/);
	assert.doesNotMatch(open, /at most/);
});

let server: FakeServer;
let cleanup: () => Promise<void>;
before(async () => {
	({ cleanup } = await useTempDataDir());
	server = await startFakeLlm(() => ({ status: 500, json: {} }));
	await saveSettings({});
});
after(async () => {
	await server.close();
	await cleanup();
	delete process.env.SE_BASE_URL_META;
	delete process.env.META_API_KEY;
});

const req: LlmRequest = { task: "draft", system: "sys", context: "ctx", prompt: "go", effort: "medium", maxTokens: 1000 };

test("a provider without a key says which key to add", async () => {
	delete process.env.GROQ_API_KEY;
	await assert.rejects(openaiStream("groq", "llama", req, () => undefined), (err: unknown) => err instanceof LlmError && err.kind === "config" && /Groq.*GROQ_API_KEY/.test(err.message));
});

test("Meta goes through the Responses API, streaming and structured", async () => {
	process.env.META_API_KEY = "meta-test-key-000";
	process.env.SE_BASE_URL_META = `${server.url}/v1`;
	server.respond((r) => {
		if (r.body?.stream) {
			return {
				sse: [
					{ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Night ", item_id: "i", output_index: 0, content_index: 0, sequence_number: 1 } },
					{ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "shifts.", item_id: "i", output_index: 0, content_index: 0, sequence_number: 2 } },
					{ event: "response.completed", data: { type: "response.completed", sequence_number: 3, response: { id: "r", object: "response", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } } },
				],
			};
		}
		return {
			json: {
				id: "r2",
				object: "response",
				status: "completed",
				output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"title":"T"}', annotations: [] }] }],
				usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
			},
		};
	});
	const start = server.calls.length;
	const deltas: string[] = [];
	const text = await openaiStream("meta", "muse-spark-1.2", req, (d) => deltas.push(d));
	assert.equal(text.text, "Night shifts.");
	assert.deepEqual(deltas, ["Night ", "shifts."]);
	const call = server.calls[start]!;
	assert.ok(call.path.endsWith("/v1/responses"), call.path);
	assert.equal(call.body.instructions, "sys");
	assert.equal(call.body.input, "ctx\n\ngo");
	assert.equal(call.headers.authorization, "Bearer meta-test-key-000");

	const obj = await openaiObject("meta", "muse-spark-1.2", req, { name: "t", schema: z.object({ title: z.string() }) });
	assert.deepEqual(obj.object, { title: "T" });
	assert.equal(server.calls.at(-1)!.body.text.format.type, "json_schema");
});
