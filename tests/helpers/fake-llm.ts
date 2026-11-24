import http from "node:http";
import type { AddressInfo } from "node:net";

/* A local stand-in for the Anthropic Messages API and OpenAI-compatible chat
 * completions, so the real SDKs and adapters can be exercised without keys. */

export interface Captured {
	method: string;
	path: string;
	headers: http.IncomingHttpHeaders;
	body: any;
}

export interface Reply {
	status?: number;
	/** Wait this long before answering (for abort and concurrency tests). */
	delayMs?: number;
	json?: unknown;
	/** Server-sent events: `event` is optional (OpenAI omits it); a string `data` is written raw. */
	sse?: { event?: string; data: unknown }[];
}

export type Responder = (req: Captured) => Reply;

export interface FakeServer {
	url: string;
	calls: Captured[];
	respond(fn: Responder): void;
	close(): Promise<void>;
}

export async function startFakeLlm(initial: Responder): Promise<FakeServer> {
	let responder = initial;
	const calls: Captured[] = [];
	const server = http.createServer(async (req, res) => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const captured: Captured = { method: req.method ?? "GET", path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null };
		calls.push(captured);
		let reply: Reply;
		try {
			reply = responder(captured);
		} catch (err) {
			reply = { status: 500, json: { error: { message: (err as Error).message } } };
		}
		if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
		if (req.socket.destroyed) return;
		if (reply.sse) {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			for (const ev of reply.sse) {
				if (ev.event) res.write(`event: ${ev.event}\n`);
				res.write(`data: ${typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data)}\n\n`);
			}
			res.end();
			return;
		}
		res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
		res.end(JSON.stringify(reply.json ?? {}));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		calls,
		respond(fn) {
			responder = fn;
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/* ---------- Anthropic shapes ---------- */

const usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 };

export function anthropicMessage(text: string, extra: Record<string, unknown> = {}) {
	return {
		id: "msg_test",
		type: "message",
		role: "assistant",
		model: "claude-opus-5-5",
		content: text ? [{ type: "text", text }] : [],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage,
		...extra,
	};
}

export function anthropicStream(pieces: string[], stopReason = "end_turn") {
	return [
		{
			event: "message_start",
			data: { type: "message_start", message: { ...anthropicMessage(""), content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } },
		},
		{ event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
		...pieces.map((text) => ({ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } })),
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
		{ event: "message_delta", data: { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 300 } } },
		{ event: "message_stop", data: { type: "message_stop" } },
	];
}

/* ---------- OpenAI shapes ---------- */

export function chatCompletion(content: string, finish = "stop") {
	return {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 1,
		model: "fake-model",
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
		usage: { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1050 },
	};
}

export function chatStream(pieces: string[], withUsage = true) {
	const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
		id: "chatcmpl-test",
		object: "chat.completion.chunk",
		created: 1,
		model: "fake-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	});
	return [
		...pieces.map((content, i) => ({ data: chunk(i === 0 ? { role: "assistant", content } : { content }, null) })),
		{ data: chunk({}, "stop") },
		...(withUsage
			? [{ data: { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [], usage: { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1050 } } }]
			: []),
		{ data: "[DONE]" },
	];
}

/** Text of the user turn, for both API shapes. */
export function userText(req: Captured): string {
	const messages: any[] = req.body?.messages ?? [];
	const user = [...messages].reverse().find((m) => m.role === "user");
	if (!user) return "";
	if (typeof user.content === "string") return user.content;
	return user.content.map((b: any) => b.text ?? "").join("\n");
}
