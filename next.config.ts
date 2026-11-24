import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The Docker image runs the self-contained server; locally `next start` serves the normal build.
	output: process.env.SE_STANDALONE === "1" ? "standalone" : undefined,
	poweredByHeader: false,
	serverExternalPackages: ["unpdf"],
	experimental: {
		// proxy.ts buffers request bodies; document imports can be up to 20 MB.
		proxyClientMaxBodySize: "25mb",
	},
};

export default nextConfig;
