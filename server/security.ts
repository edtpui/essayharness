/* API requests are refused unless they come to a local host name (or one the
 * owner allowlisted) and, for anything that changes state, from this app's
 * own origin. This blocks DNS-rebinding pages and cross-site form posts from
 * reading the experience bank or spending API credit. */

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

export function allowedHostNames(): Set<string> {
	return new Set(
		(process.env.SE_ALLOWED_HOSTS ?? "")
			.split(",")
			.map((h) => h.trim().toLowerCase())
			.filter(Boolean),
	);
}

/** "[::1]:3400" → "::1", "localhost:3400" → "localhost". */
export function hostnameOf(host: string): string {
	const h = host.trim().toLowerCase();
	if (h.startsWith("[")) {
		const end = h.indexOf("]");
		return end === -1 ? h : h.slice(1, end);
	}
	const colon = h.lastIndexOf(":");
	return colon === -1 ? h : h.slice(0, colon);
}

export function isLocalHostName(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost") || IPV4.test(hostname) || hostname.includes(":");
}

export function requestRefusal(headers: Headers, method: string, allowed: Set<string> = allowedHostNames()): string | null {
	const host = headers.get("host") ?? "";
	const hostname = hostnameOf(host);
	if (!hostname || !(isLocalHostName(hostname) || allowed.has(hostname))) {
		return `Requests to host "${hostname || "(none)"}" are refused. Add it to SE_ALLOWED_HOSTS to serve the app under that name.`;
	}
	if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

	const site = headers.get("sec-fetch-site");
	if (site && site !== "same-origin" && site !== "none") return "Cross-site requests are refused.";
	const origin = headers.get("origin");
	if (origin === null) return null; // not a browser form/fetch from another site
	let originHost: string;
	try {
		originHost = new URL(origin).host.toLowerCase();
	} catch {
		return "Cross-origin requests are refused.";
	}
	if (originHost === host.toLowerCase() || allowed.has(hostnameOf(originHost))) return null;
	return "Cross-origin requests are refused.";
}
