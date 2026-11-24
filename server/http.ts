import type { ZodType } from "zod";
import { HttpError, LlmError } from "./errors";
import { zodIssues } from "./llm/shared";
import { CorruptRecordError, assertId } from "./store";

export function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(err: unknown): Response {
	if (err instanceof HttpError) return json({ error: err.message }, err.status);
	if (err instanceof LlmError) return json({ error: err.message, kind: err.kind }, err.status);
	if (err instanceof CorruptRecordError) {
		console.error("[api]", err.message);
		return json({ error: err.message }, 500);
	}
	console.error("[api] unexpected error:", err);
	return json({ error: "Unexpected server error. The server log has the details." }, 500);
}

/** Wraps a route handler so every failure becomes a JSON error response. */
export function handler<C>(fn: (req: Request, ctx: C) => Promise<Response>): (req: Request, ctx: C) => Promise<Response> {
	return async (req, ctx) => {
		try {
			return await fn(req, ctx);
		} catch (err) {
			return errorResponse(err);
		}
	};
}

export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		throw new HttpError(400, "The request body must be JSON.");
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw new HttpError(400, zodIssues(parsed.error));
	return parsed.data;
}

export type IdContext = { params: Promise<{ id: string }> };

export async function idFrom(ctx: IdContext): Promise<string> {
	const { id } = await ctx.params;
	assertId(id);
	return id;
}
