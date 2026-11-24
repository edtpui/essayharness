import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProvider } from "@/components/app-context";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
	title: "Scholarship Essays",
	description: "Dictate your life experiences into a local experience bank and draft grounded scholarship essays from it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body className="min-h-screen">
				<AppProvider>
					<div className="flex min-h-screen flex-col md:flex-row">
						<Nav />
						<main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
							<div className="mx-auto max-w-6xl">{children}</div>
						</main>
					</div>
				</AppProvider>
			</body>
		</html>
	);
}
