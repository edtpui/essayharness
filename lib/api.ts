import type { GenerationEvent } from "./types";

/* Browser-side helpers for the app's own API. */

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly kind?: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

interface ApiInit {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	form?: FormData;
	signal?: AbortSignal;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
	const hasJson = init.body !== undefined;
	let res: Response;
	try {
		res = await fetch(path, {
			method: init.method ?? (hasJson || init.form ? "POST" : "GET"),
			headers: hasJson ? { "Content-Type": "application/json" } : undefined,
			body: init.form ?? (hasJson ? JSON.stringify(init.body) : undefined),
			signal: init.signal,
			cache: "no-store",
		});
	} catch (err) {
		if ((err as Error).name === "AbortError") throw err;
		throw new ApiError("Couldn't reach the app server. Is it still running?", 0);
	}
	const text = await res.text();
	let data: unknown = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = null;
		}
	}
	if (!res.ok) {
		const body = (data ?? {}) as { error?: string; kind?: string };
		throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.kind);
	}
	return data as T;
}

/** Reads the newline-delimited JSON stream from /generate. */
export async function streamGeneration(
	path: string,
	body: unknown,
	onEvent: (event: GenerationEvent) => void,
): Promise<void> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			cache: "no-store",
		});
	} catch {
		throw new ApiError("Couldn't reach the app server. Is it still running?", 0);
	}
	if (!res.ok || !res.body) {
		const data = (await res.json().catch(() => ({}))) as { error?: string };
		throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let newline: number;
		while ((newline = buffer.indexOf("\n")) !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) onEvent(JSON.parse(line) as GenerationEvent);
		}
	}
	const rest = buffer.trim();
	if (rest) onEvent(JSON.parse(rest) as GenerationEvent);
}

export function messageOf(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
