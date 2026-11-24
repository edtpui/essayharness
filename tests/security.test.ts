import assert from "node:assert/strict";
import { test } from "node:test";
import { hostnameOf, requestRefusal } from "@/server/security";

const h = (init: Record<string, string>) => new Headers(init);
const none = new Set<string>();

test("hostnameOf strips ports and IPv6 brackets", () => {
	assert.equal(hostnameOf("localhost:3400"), "localhost");
	assert.equal(hostnameOf("[::1]:3400"), "::1");
	assert.equal(hostnameOf("My-PC.ts.net"), "my-pc.ts.net");
});

test("local host names and IP literals are allowed", () => {
	for (const host of ["localhost:3400", "127.0.0.1:3400", "[::1]:3400", "app.localhost", "192.168.1.20:3400"]) {
		assert.equal(requestRefusal(h({ host }), "GET", none), null, host);
	}
});

test("other host names are refused unless allowlisted (DNS rebinding)", () => {
	assert.match(requestRefusal(h({ host: "evil.example:3400" }), "GET", none) ?? "", /refused/);
	assert.equal(requestRefusal(h({ host: "my-pc.tail.ts.net" }), "GET", new Set(["my-pc.tail.ts.net"])), null);
});

test("state-changing requests from another origin are refused", () => {
	assert.equal(requestRefusal(h({ host: "127.0.0.1:3400", origin: "http://127.0.0.1:3400" }), "POST", none), null);
	assert.equal(requestRefusal(h({ host: "127.0.0.1:3400" }), "POST", none), null); // curl, no Origin
	assert.match(requestRefusal(h({ host: "127.0.0.1:3400", origin: "http://1.2.3.4" }), "POST", none) ?? "", /Cross-origin/);
	assert.match(requestRefusal(h({ host: "127.0.0.1:3400", origin: "null" }), "PUT", none) ?? "", /Cross-origin/);
	assert.match(requestRefusal(h({ host: "127.0.0.1:3400", "sec-fetch-site": "cross-site" }), "DELETE", none) ?? "", /Cross-site/);
	assert.match(requestRefusal(h({ host: "localhost:3400", origin: "http://localhost:3000" }), "POST", none) ?? "", /Cross-origin/);
});

test("an allowlisted proxy origin may post to a rewritten host", () => {
	const allowed = new Set(["my-pc.tail.ts.net"]);
	assert.equal(requestRefusal(h({ host: "127.0.0.1:3400", origin: "https://my-pc.tail.ts.net" }), "POST", allowed), null);
});
