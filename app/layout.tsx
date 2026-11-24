import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Familjen_Grotesk, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { AppProvider } from "@/components/app-context";
import { Nav } from "@/components/nav";
import "./globals.css";

// Self-hosted at build time: no request to Google when the app runs.
const display = Familjen_Grotesk({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-outlier", display: "swap" });

export const metadata: Metadata = {
	title: "EssayHarness",
	description: "Dictate your life experiences into a local experience bank and draft grounded scholarship essays from it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
			<body className="min-h-screen">
				<AppProvider>
					<Nav />
					<main className="container py-8">{children}</main>
				</AppProvider>
			</body>
		</html>
	);
}
