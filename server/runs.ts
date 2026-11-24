import { HttpError } from "./errors";

/* One model run per essay at a time, so two tabs can't race each other and
 * Stop can reach the run that is in progress. In memory: a server restart
 * ends every run anyway. */

export type RunKind = "plan" | "draft" | "revise" | "tighten" | "audit";

interface Run {
	kind: RunKind;
	controller: AbortController;
	startedAt: number;
}

const g = globalThis as typeof globalThis & { __seRuns?: Map<string, Run> };
const runs: Map<string, Run> = (g.__seRuns ??= new Map());

const VERB: Record<RunKind, string> = {
	plan: "planning",
	draft: "drafting",
	revise: "revising",
	tighten: "tightening",
	audit: "fact-checking",
};

export function beginRun(key: string, kind: RunKind): AbortController {
	const existing = runs.get(key);
	if (existing) throw new HttpError(409, `Already ${VERB[existing.kind]} this essay. Wait for it to finish or stop it.`);
	const controller = new AbortController();
	runs.set(key, { kind, controller, startedAt: Date.now() });
	return controller;
}

export function endRun(key: string, controller: AbortController): void {
	if (runs.get(key)?.controller === controller) runs.delete(key);
}

export function stopRun(key: string): boolean {
	const run = runs.get(key);
	if (!run) return false;
	run.controller.abort();
	return true;
}

export function activeRun(key: string): { kind: RunKind; startedAt: number } | null {
	const run = runs.get(key);
	return run ? { kind: run.kind, startedAt: run.startedAt } : null;
}

export async function withRun<T>(key: string, kind: RunKind, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = beginRun(key, kind);
	try {
		return await fn(controller.signal);
	} finally {
		endRun(key, controller);
	}
}
