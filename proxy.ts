import { NextResponse, type NextRequest } from "next/server";
import { requestRefusal } from "./server/security";

/** Guards every API route (see server/security.ts). Pages carry no data of their own. */
export function proxy(request: NextRequest) {
	const refusal = requestRefusal(request.headers, request.method.toUpperCase());
	if (refusal) {
		return NextResponse.json({ error: refusal }, { status: 403, headers: { "Cache-Control": "no-store" } });
	}
	return NextResponse.next();
}

export const config = {
	matcher: ["/api", "/api/:path*"],
};
