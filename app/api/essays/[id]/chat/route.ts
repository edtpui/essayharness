import { z } from "zod";
import type { ChatEvent } from "@/lib/types";
import { chatTurn } from "@/server/chat";
import { essays } from "@/server/db";
import { errorMessage } from "@/server/errors";
import { errorResponse, idFrom, readBody, type IdContext } from "@/server/http";
import { activeRun } from "@/server/runs";

const ChatInput = z.object({ text: z.string().max(20000) });

/** Streams one chat turn as newline-delimited JSON events. The turn belongs to
 *  the server: closing the page doesn't stop it; /stop does. */
export async function POST(req: Request, ctx: IdContext): Promise<Response> {
	let id: string;
	let text: string;
	try {
		id = await idFrom(ctx);
		({ text } = await readBody(req, ChatInput));
		await essays.require(id, "Essay");
		if (activeRun(id)) return Response.json({ error: "Still working on the last message. Wait for it or stop it." }, { status: 409 });
	} catch (err) {
		return errorResponse(err);
	}

	const encoder = new TextEncoder();
	let open = true;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: ChatEvent) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					open = false;
				}
			};
			chatTurn(id, text, send)
				.catch((err) => send({ type: "error", message: errorMessage(err) }))
				.finally(() => {
					if (!open) return;
					open = false;
					try {
						controller.close();
					} catch {
						// closed by the client
					}
				});
		},
		cancel() {
			open = false;
		},
	});
	return new Response(stream, {
		headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
	});
}
