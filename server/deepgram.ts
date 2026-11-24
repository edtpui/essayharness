import { getCredential } from "./db";
import { HttpError } from "./errors";

/** Mints a short-lived Deepgram token so the browser can stream audio straight
 *  to Deepgram without ever holding the real key. The token is checked only at
 *  the WebSocket handshake, so a long dictation outlives its TTL. Minting needs
 *  a key with at least Member permission in the Deepgram console. */
export async function mintDeepgramToken(): Promise<string> {
	const key = await getCredential("deepgram");
	if (!key) throw new HttpError(400, "Add a Deepgram API key in Settings to use dictation.");
	let res: Response;
	try {
		res = await fetch("https://api.deepgram.com/v1/auth/grant", {
			method: "POST",
			headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ttl_seconds: 300 }),
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw new HttpError(502, "Couldn't reach Deepgram. Check your connection.");
	}
	if (res.status === 401) throw new HttpError(502, "Deepgram rejected the API key. Check it in Settings.");
	if (res.status === 403) {
		throw new HttpError(502, "This Deepgram key can't mint dictation tokens. Create a key with Member (or higher) permission.");
	}
	if (!res.ok) {
		const detail = (await res.text().catch(() => "")).slice(0, 200);
		throw new HttpError(502, `Deepgram token request failed (${res.status})${detail ? `: ${detail}` : ""}`);
	}
	const data = (await res.json().catch(() => ({}))) as { access_token?: unknown };
	if (typeof data.access_token !== "string" || !data.access_token) throw new HttpError(502, "Deepgram returned no token.");
	return data.access_token;
}
