import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getCredential } from "../db";
import { LlmError } from "../errors";
import { recordUsage } from "../usage";
import type { LlmRequest, ObjectResult, StructuredSpec, TextResult } from "./shared";

/** Server-side refusal fallback. "default" lets the API pick the fallback per
 *  refusal category; on models without fallbacks it runs the requested model alone. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Models that accept output_config.effort (low/medium/high). */
const EFFORT_MODELS = /^claude-(fable|mythos|opus-5|opus-4-[5-8]|sonnet-5|sonnet-4-6|haiku-5)/;

async function client(): Promise<Anthropic> {
	const apiKey = await getCredential("anthropic");
	if (!apiKey) throw new LlmError("Add your Anthropic API key in Settings (or set ANTHROPIC_API_KEY).", "config");
	return new Anthropic({ apiKey, maxRetries: 2 });
}

/** Request body shared by text and structured calls. Exported for tests. */
export function buildRequest(model: string, req: LlmRequest) {
	const content: BetaTextBlockParam[] = [];
	// The stable material goes first and is cached, so revisions of the same
	// essay re-read the bank from cache instead of paying for it again.
	if (req.context) content.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
	content.push({ type: "text", text: req.prompt });
	return {
		model,
		max_tokens: req.maxTokens,
		system: req.system,
		messages: [{ role: "user" as const, content }],
		betas: [FALLBACK_BETA],
		fallbacks: "default" as const,
		effort: EFFORT_MODELS.test(model) ? req.effort : undefined,
	};
}

function textOf(message: BetaMessage): string {
	return message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
}

async function record(message: BetaMessage, req: LlmRequest): Promise<void> {
	const usage = message.usage;
	await recordUsage({
		task: req.task,
		provider: "anthropic",
		model: message.model,
		essayId: req.essayId,
		usage: {
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			cacheReadTokens: usage.cache_read_input_tokens ?? 0,
			cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
		},
	});
}

function assertComplete(message: BetaMessage): void {
	switch (message.stop_reason) {
		case "refusal": {
			const category = message.stop_details?.category;
			throw new LlmError(
				`Claude declined this request${category ? ` (${category})` : ""}, and no fallback model completed it. ` +
					"Try again, reword the material involved, or choose another model in Settings.",
				"refusal",
			);
		}
		case "max_tokens":
			throw new LlmError("Claude stopped at the output limit before finishing. Try again.", "truncated");
		case "model_context_window_exceeded":
			throw new LlmError("There is too much material for this model's context window.", "truncated");
		default:
			return;
	}
}

export function translateAnthropicError(err: unknown): LlmError {
	if (err instanceof LlmError) return err;
	if (err instanceof Anthropic.APIUserAbortError) return new LlmError("Stopped.", "aborted");
	if (err instanceof Anthropic.APIConnectionError) return new LlmError("Couldn't reach the Anthropic API. Check your connection.", "connection");
	if (err instanceof Anthropic.AuthenticationError) return new LlmError("Anthropic rejected the API key. Check it in Settings.", "auth");
	if (err instanceof Anthropic.PermissionDeniedError) return new LlmError(`Anthropic refused this key: ${err.message}`, "auth");
	if (err instanceof Anthropic.PaymentRequiredError) return new LlmError(`Anthropic billing problem: ${err.message}`, "billing");
	if (err instanceof Anthropic.NotFoundError) return new LlmError(`Model not found or not available to this key: ${err.message}`, "not_found");
	if (err instanceof Anthropic.RateLimitError) return new LlmError("Anthropic rate limit reached. Wait a minute and try again.", "rate_limit");
	if (err instanceof Anthropic.BadRequestError) return new LlmError(`Anthropic rejected the request: ${err.message}`, "bad_request");
	if (err instanceof Anthropic.InternalServerError) return new LlmError("Anthropic had a server error. Try again shortly.", "server");
	if (err instanceof Anthropic.APIError) return new LlmError(`Anthropic API error: ${err.message}`, "server");
	if (err instanceof Anthropic.AnthropicError) return new LlmError(`Claude's reply could not be read: ${err.message}`, "invalid_output");
	return new LlmError(err instanceof Error ? err.message : String(err), "server");
}

export async function anthropicStream(model: string, req: LlmRequest, onDelta: (text: string) => void): Promise<TextResult> {
	const c = await client();
	const { effort, ...body } = buildRequest(model, req);
	try {
		const stream = c.beta.messages.stream(
			{ ...body, ...(effort ? { output_config: { effort } } : {}) },
			{ signal: req.signal },
		);
		// A mid-stream fallback keeps the partial text and continues it on the
		// fallback model, so every text delta belongs to the final answer.
		for await (const event of stream) {
			if (event.type === "content_block_delta" && event.delta.type === "text_delta") onDelta(event.delta.text);
		}
		const message = await stream.finalMessage();
		await record(message, req);
		assertComplete(message);
		return { text: textOf(message), model: message.model };
	} catch (err) {
		throw translateAnthropicError(err);
	}
}

export async function anthropicObject<T>(model: string, req: LlmRequest, spec: StructuredSpec<T>): Promise<ObjectResult<T>> {
	const c = await client();
	const { effort, ...body } = buildRequest(model, req);
	try {
		const message = await c.beta.messages.parse(
			{ ...body, output_config: { ...(effort ? { effort } : {}), format: betaZodOutputFormat(spec.schema) } },
			{ signal: req.signal },
		);
		await record(message, req);
		assertComplete(message);
		if (message.parsed_output == null) {
			throw new LlmError("Claude's reply did not match the expected structure. Try again.", "invalid_output");
		}
		return { object: message.parsed_output as T, model: message.model };
	} catch (err) {
		throw translateAnthropicError(err);
	}
}

export async function anthropicModels(): Promise<string[]> {
	const c = await client();
	const ids: string[] = [];
	try {
		for await (const model of c.models.list({ limit: 100 })) {
			ids.push(model.id);
			if (ids.length >= 200) break;
		}
	} catch (err) {
		throw translateAnthropicError(err);
	}
	return ids;
}
