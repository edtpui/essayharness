import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ZodType } from "zod";
import { getCredential, getSettings } from "../db";
import { LlmError } from "../errors";
import { recordUsage } from "../usage";
import {
	ThinkTagFilter,
	extractJsonObject,
	strictJsonSchema,
	zodIssues,
	type LlmRequest,
	type ObjectResult,
	type StructuredSpec,
	type TextResult,
} from "./shared";

/* OpenAI itself, plus any OpenAI-compatible server (Ollama, LM Studio,
 * OpenRouter, vLLM …) through the "custom" provider. */

export type OpenAiProvider = "openai" | "custom";

interface Connection {
	client: OpenAI;
	label: string;
	baseURL: string;
}

async function connect(provider: OpenAiProvider): Promise<Connection> {
	if (provider === "openai") {
		const apiKey = await getCredential("openai");
		if (!apiKey) throw new LlmError("Add your OpenAI API key in Settings (or set OPENAI_API_KEY).", "config");
		const baseURL = "https://api.openai.com/v1";
		return { client: new OpenAI({ apiKey, baseURL, maxRetries: 2 }), label: "OpenAI", baseURL };
	}
	const settings = await getSettings();
	const baseURL = settings.customBaseUrl.trim().replace(/\/+$/, "");
	if (!baseURL) throw new LlmError("Set the custom endpoint's base URL in Settings.", "config");
	const apiKey = (await getCredential("custom")) ?? "not-needed";
	// Local models can take minutes on a long essay.
	return {
		client: new OpenAI({ apiKey, baseURL, maxRetries: 1, timeout: 15 * 60 * 1000 }),
		label: settings.customName.trim() || "The custom endpoint",
		baseURL,
	};
}

function buildMessages(req: LlmRequest, systemSuffix = ""): ChatCompletionMessageParam[] {
	return [
		{ role: "system", content: req.system + systemSuffix },
		{ role: "user", content: req.context ? `${req.context}\n\n${req.prompt}` : req.prompt },
	];
}

function translate(err: unknown, conn: Connection, model: string): LlmError {
	if (err instanceof LlmError) return err;
	if (err instanceof OpenAI.APIUserAbortError) return new LlmError("Stopped.", "aborted");
	if (err instanceof OpenAI.APIConnectionError) return new LlmError(`Couldn't reach ${conn.label} at ${conn.baseURL}. Is it running?`, "connection");
	if (err instanceof OpenAI.AuthenticationError) return new LlmError(`${conn.label} rejected the API key. Check it in Settings.`, "auth");
	if (err instanceof OpenAI.PermissionDeniedError) return new LlmError(`${conn.label} refused the request: ${err.message}`, "auth");
	if (err instanceof OpenAI.NotFoundError) return new LlmError(`${conn.label} has no model "${model}" (or the base URL is wrong).`, "not_found");
	if (err instanceof OpenAI.RateLimitError) return new LlmError(`${conn.label} rate limit reached. Wait and try again.`, "rate_limit");
	if (err instanceof OpenAI.BadRequestError) return new LlmError(`${conn.label} rejected the request: ${err.message}`, "bad_request");
	if (err instanceof OpenAI.APIError) return new LlmError(`${conn.label} error: ${err.message}`, "server");
	return new LlmError(err instanceof Error ? err.message : String(err), "server");
}

async function record(provider: OpenAiProvider, model: string, req: LlmRequest, usage: OpenAI.CompletionUsage | null | undefined) {
	await recordUsage({
		task: req.task,
		provider,
		model,
		essayId: req.essayId,
		usage: {
			inputTokens: usage?.prompt_tokens ?? 0,
			outputTokens: usage?.completion_tokens ?? 0,
			cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
		},
	});
}

export async function openaiStream(
	provider: OpenAiProvider,
	model: string,
	req: LlmRequest,
	onDelta: (text: string) => void,
): Promise<TextResult> {
	const conn = await connect(provider);
	const filter = new ThinkTagFilter();
	let text = "";
	let usage: OpenAI.CompletionUsage | null | undefined;
	let finish: string | null = null;
	let emitted = false;

	const run = async (includeUsage: boolean) => {
		const stream = await conn.client.chat.completions.create(
			{
				model,
				messages: buildMessages(req),
				stream: true,
				...(includeUsage ? { stream_options: { include_usage: true } } : {}),
			},
			{ signal: req.signal },
		);
		for await (const chunk of stream) {
			const choice = chunk.choices?.[0];
			const delta = choice?.delta?.content;
			if (delta) {
				const visible = filter.push(delta);
				if (visible) {
					// Drop the blank lines a reasoning model leaves after its hidden thinking.
					const out = emitted ? visible : visible.replace(/^\s+/, "");
					if (out) {
						emitted = true;
						text += out;
						onDelta(out);
					}
				}
			}
			if (choice?.finish_reason) finish = choice.finish_reason;
			if (chunk.usage) usage = chunk.usage;
		}
	};

	try {
		try {
			await run(true);
		} catch (err) {
			// Some compatible servers reject stream_options; retry once without usage reporting.
			if (!emitted && err instanceof OpenAI.BadRequestError && /stream_options|include_usage/i.test(err.message)) await run(false);
			else throw err;
		}
		const tail = filter.flush();
		if (tail) {
			text += tail;
			onDelta(tail);
		}
	} catch (err) {
		throw translate(err, conn, model);
	}
	await record(provider, model, req, usage);
	if (finish === "length") throw new LlmError(`${conn.label} stopped at its output limit before finishing.`, "truncated");
	if (finish === "content_filter") throw new LlmError(`${conn.label} declined to write this.`, "refusal");
	return { text: text.trim(), model };
}

type ResponseFormat =
	| { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } }
	| { type: "json_object" };

function parseAgainst<T>(schema: ZodType<T>, content: string): { ok: true; value: T } | { ok: false; error: string } {
	let raw: unknown;
	try {
		raw = extractJsonObject(content);
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
	const parsed = schema.safeParse(raw);
	return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: zodIssues(parsed.error) };
}

export async function openaiObject<T>(
	provider: OpenAiProvider,
	model: string,
	req: LlmRequest,
	spec: StructuredSpec<T>,
): Promise<ObjectResult<T>> {
	const conn = await connect(provider);
	const schema = strictJsonSchema(spec.schema);
	const strictFormat: ResponseFormat = { type: "json_schema", json_schema: { name: spec.name, schema, strict: true } };
	// Compatible servers vary: try schema-constrained output, then JSON mode, then plain text.
	const formats: Array<ResponseFormat | null> = provider === "openai" ? [strictFormat] : [strictFormat, { type: "json_object" }, null];
	const schemaHint =
		provider === "custom"
			? `\n\nReply with only a JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(schema)}`
			: "";
	const messages = buildMessages(req, schemaHint);

	const complete = async (msgs: ChatCompletionMessageParam[], format: ResponseFormat | null) => {
		const res = await conn.client.chat.completions.create(
			{ model, messages: msgs, ...(format ? { response_format: format } : {}) },
			{ signal: req.signal },
		);
		await record(provider, model, req, res.usage);
		const choice = res.choices[0];
		if (choice?.finish_reason === "length") throw new LlmError(`${conn.label} stopped at its output limit before finishing.`, "truncated");
		return choice?.message?.content ?? "";
	};

	let lastRejection = "";
	for (let i = 0; i < formats.length; i++) {
		const format = formats[i] ?? null;
		let content: string;
		try {
			content = await complete(messages, format);
		} catch (err) {
			if (err instanceof OpenAI.BadRequestError && i < formats.length - 1) {
				lastRejection = err.message;
				continue;
			}
			throw translate(err, conn, model);
		}
		const first = parseAgainst(spec.schema, content);
		if (first.ok) return { object: first.value, model };

		let repaired: string;
		try {
			repaired = await complete(
				[
					...messages,
					{ role: "assistant", content },
					{ role: "user", content: `That reply was not valid (${first.error}). Reply again with only the corrected JSON object.` },
				],
				format,
			);
		} catch (err) {
			throw translate(err, conn, model);
		}
		const second = parseAgainst(spec.schema, repaired);
		if (second.ok) return { object: second.value, model };
		throw new LlmError(`${conn.label} returned a reply that didn't match the expected structure (${second.error}).`, "invalid_output");
	}
	throw new LlmError(`${conn.label} rejected structured output: ${lastRejection}`, "bad_request");
}

export async function openaiModels(provider: OpenAiProvider): Promise<string[]> {
	const conn = await connect(provider);
	const ids: string[] = [];
	try {
		for await (const model of conn.client.models.list()) {
			ids.push(model.id);
			if (ids.length >= 300) break;
		}
	} catch (err) {
		throw translate(err, conn, "");
	}
	return ids.sort();
}
