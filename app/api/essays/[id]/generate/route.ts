import { z } from "zod";
import type { GenerationEvent } from "@/lib/types";
import { errorMessage } from "@/server/errors";
import { generateVersion } from "@/server/essays";
import { errorResponse, idFrom, readBody, type IdContext } from "@/server/http";
import { activeRun } from "@/server/runs";

const GenerateInput = z.object({
	mode: z.enum(["draft", "revise", "tighten"]),
	instruction: z.string().max(10000).optional(),
	baseVersionId: z.string().optional(),
});

/** Streams the essay as it is written, one JSON event per line. The run is
 *  owned by the server: if the page closes, it still finishes and saves; only
 *  /stop aborts it. */
export async function POST(req: Request, ctx: IdContext): Promise<Response> {
	let id: string;
	let input: z.infer<typeof GenerateInput>;
	try {
		id = await idFrom(ctx);
		input = await readBody(req, GenerateInput);
		if (activeRun(id)) {
			return Response.json({ error: "This essay is already being worked on. Wait for it to finish or stop it." }, { status: 409 });
		}
	} catch (err) {
		return errorResponse(err);
	}

	const encoder = new TextEncoder();
	let open = true;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: GenerationEvent) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					open = false;
				}
			};
			generateVersion(id, input, (text) => send({ type: "delta", text }))
				.then((version) => send({ type: "done", version }))
				.catch((err) => send({ type: "error", message: errorMessage(err) }))
				.finally(() => {
					if (!open) return;
					open = false;
					try {
						controller.close();
					} catch {
						// already closed by the client
					}
				});
		},
		cancel() {
			open = false;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-store, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
