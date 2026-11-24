import { z, type ZodType } from "zod";
import type { UsageTask } from "@/lib/types";

export type Effort = "low" | "medium" | "high";

/** One single-turn model call. `context` is the large, stable part of the
 *  user turn (bank, brief, profile) and is marked cacheable where supported;
 *  `prompt` is the part that changes between calls. */
export interface LlmRequest {
	task: UsageTask;
	essayId?: string | null;
	system: string;
	context?: string;
	prompt: string;
	effort: Effort;
	maxTokens: number;
	signal?: AbortSignal;
}

export interface TextResult {
	text: string;
	model: string;
}

export interface ObjectResult<T> {
	object: T;
	model: string;
}

export interface StructuredSpec<T> {
	name: string;
	schema: ZodType<T>;
}

/** Removes <think>…</think> spans that some local reasoning models emit inline,
 *  including tags split across streamed chunks. */
export class ThinkTagFilter {
	private buffer = "";
	private inThink = false;

	push(chunk: string): string {
		this.buffer += chunk;
		let out = "";
		for (;;) {
			if (this.inThink) {
				const end = this.buffer.indexOf("</think>");
				if (end === -1) {
					this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - ("</think>".length - 1)));
					return out;
				}
				this.buffer = this.buffer.slice(end + "</think>".length);
				this.inThink = false;
				continue;
			}
			const start = this.buffer.indexOf("<think>");
			if (start === -1) {
				const keep = partialSuffix(this.buffer, "<think>");
				out += this.buffer.slice(0, this.buffer.length - keep);
				this.buffer = this.buffer.slice(this.buffer.length - keep);
				return out;
			}
			out += this.buffer.slice(0, start);
			this.buffer = this.buffer.slice(start + "<think>".length);
			this.inThink = true;
		}
	}

	flush(): string {
		const rest = this.inThink ? "" : this.buffer;
		this.buffer = "";
		this.inThink = false;
		return rest;
	}
}

function partialSuffix(text: string, tag: string): number {
	for (let k = Math.min(tag.length - 1, text.length); k > 0; k--) {
		if (tag.startsWith(text.slice(-k))) return k;
	}
	return 0;
}

export function stripThinking(text: string): string {
	const filter = new ThinkTagFilter();
	return (filter.push(text) + filter.flush()).trim();
}

/** Pulls the JSON object out of a model reply that may wrap it in prose or code fences. */
export function extractJsonObject(text: string): unknown {
	const cleaned = stripThinking(text);
	const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? cleaned;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) throw new Error("The reply contained no JSON object.");
	return JSON.parse(candidate.slice(start, end + 1));
}

const UNSUPPORTED_KEYWORDS = new Set([
	"$schema",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minLength",
	"maxLength",
	"pattern",
	"format",
	"minItems",
	"maxItems",
	"default",
]);

/** JSON Schema for OpenAI-style strict structured output: every property
 *  required, no extra properties, and no validation keywords strict mode rejects
 *  (the zod schema still enforces nothing beyond shape here). */
export function strictJsonSchema(schema: ZodType): Record<string, unknown> {
	const walk = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(walk);
		if (!node || typeof node !== "object") return node;
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			if (UNSUPPORTED_KEYWORDS.has(key)) continue;
			out[key] = key === "properties" && value && typeof value === "object"
				? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
				: walk(value);
		}
		if (out.type === "object" && out.properties && typeof out.properties === "object") {
			out.required = Object.keys(out.properties);
			out.additionalProperties = false;
		}
		return out;
	};
	return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export function zodIssues(error: z.ZodError): string {
	return error.issues
		.slice(0, 8)
		.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
		.join("; ");
}
