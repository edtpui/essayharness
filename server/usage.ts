import type { Provider, UsageRecord, UsageSummary, UsageTask } from "@/lib/types";
import { appendLine, nowIso, readLines } from "./store";

/** USD per million tokens, Anthropic first-party list prices (2026-11). Others are unpriced. */
const PRICES: Record<string, { input: number; output: number; cacheRead?: number }> = {
	"claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
	"claude-fable-5-1": { input: 10, output: 50 },
	"claude-fable-5": { input: 10, output: 50 },
	"claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
	"claude-opus-5": { input: 5, output: 25 },
	"claude-opus-4-8": { input: 5, output: 25 },
	"claude-opus-4-7": { input: 5, output: 25 },
	"claude-opus-4-6": { input: 5, output: 25 },
	"claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
	"claude-sonnet-5": { input: 2, output: 10 },
	"claude-sonnet-4-6": { input: 3, output: 15 },
	"claude-haiku-5-5": { input: 0.1, output: 0.5 },
	"claude-haiku-4-5": { input: 1, output: 5 },
};

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

/** An estimate: list prices, 1.25x for cache writes, 0.1x input for cache reads unless listed. */
export function estimateCost(model: string, usage: TokenUsage): number | null {
	const price = PRICES[model];
	if (!price) return null;
	const cacheRead = usage.cacheReadTokens ?? 0;
	const cacheWrite = usage.cacheWriteTokens ?? 0;
	return (
		(usage.inputTokens * price.input +
			cacheWrite * price.input * 1.25 +
			cacheRead * (price.cacheRead ?? price.input * 0.1) +
			usage.outputTokens * price.output) /
		1_000_000
	);
}

export async function recordUsage(entry: {
	task: UsageTask;
	provider: Provider;
	model: string;
	essayId?: string | null;
	usage: TokenUsage;
}): Promise<void> {
	const record: UsageRecord = {
		at: nowIso(),
		task: entry.task,
		provider: entry.provider,
		model: entry.model,
		essayId: entry.essayId ?? null,
		inputTokens: entry.usage.inputTokens,
		outputTokens: entry.usage.outputTokens,
		cacheReadTokens: entry.usage.cacheReadTokens ?? 0,
		cacheWriteTokens: entry.usage.cacheWriteTokens ?? 0,
		costUsd: entry.provider === "anthropic" ? estimateCost(entry.model, entry.usage) : null,
	};
	try {
		await appendLine("usage.jsonl", JSON.stringify(record));
	} catch (err) {
		// Usage accounting must never fail the work it describes.
		console.error("[usage] could not record usage:", (err as Error).message);
	}
}

export async function usageSummary(): Promise<UsageSummary> {
	const records: UsageRecord[] = [];
	for (const line of await readLines("usage.jsonl")) {
		try {
			records.push(JSON.parse(line) as UsageRecord);
		} catch {
			console.error("[usage] skipping malformed usage line");
		}
	}
	const summary: UsageSummary = {
		totalCostUsd: 0,
		unpricedCalls: 0,
		calls: records.length,
		inputTokens: 0,
		outputTokens: 0,
		byTask: {},
		byEssay: {},
		recent: records.slice(-25).reverse(),
	};
	for (const r of records) {
		const cost = r.costUsd ?? 0;
		if (r.costUsd === null) summary.unpricedCalls++;
		summary.totalCostUsd += cost;
		summary.inputTokens += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
		summary.outputTokens += r.outputTokens;
		const t = (summary.byTask[r.task] ??= { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 });
		t.calls++;
		t.costUsd += cost;
		t.inputTokens += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
		t.outputTokens += r.outputTokens;
		if (r.essayId) summary.byEssay[r.essayId] = (summary.byEssay[r.essayId] ?? 0) + cost;
	}
	return summary;
}
