"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-context";
import { cx } from "./ui";

const LINKS = [
	{ href: "/", label: "Capture" },
	{ href: "/bank", label: "Experience bank" },
	{ href: "/graph", label: "Graph" },
	{ href: "/essays", label: "Essays" },
	{ href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
	return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The top bar: wordmark, five destinations, and the model in use. */
export function Nav() {
	const pathname = usePathname();
	const { view, loadError } = useApp();
	const needsKey = view && view.settings.mainModel.provider !== "custom" && (view.credentials[view.settings.mainModel.provider]?.source ?? "none") === "none";

	return (
		<header className="sticky top-0 z-(--z-sticky-nav) border-b border-rule bg-paper/95 backdrop-blur-sm">
			<div className="container flex h-(--bar-height) items-center gap-6">
				<Link href="/" className="flex shrink-0 items-center gap-2 font-display text-lg font-semibold tracking-tight no-underline" aria-label="Scholarship Essays, home">
					<img src="/logo.svg" alt="" width={28} height={28} className="rounded-md" />
					Scholarship Essays
				</Link>
				<nav aria-label="Main" className="min-w-0 flex-1 overflow-x-auto">
					<ul className="flex items-center gap-1">
						{LINKS.map((link) => {
							const active = isActive(pathname, link.href);
							return (
								<li key={link.href}>
									<Link
										href={link.href}
										aria-current={active ? "page" : undefined}
										className={cx(
											"block rounded-(--radius-input) px-3 py-1.5 text-sm whitespace-nowrap no-underline transition-colors duration-(--dur-micro)",
											active ? "bg-accent-wash text-accent" : "text-ink-2 hover:bg-paper-3 hover:text-ink active:bg-paper-3",
										)}
									>
										{link.label}
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>
				<div className="hidden shrink-0 text-sm lg:block">
					{loadError ? (
						<span className="text-error">{loadError}</span>
					) : needsKey ? (
						<Link href="/settings" className="link text-warn">
							Add an API key to start writing
						</Link>
					) : view ? (
						<span className="mono text-xs text-muted" title="The writing model">
							{view.settings.mainModel.model}
						</span>
					) : null}
				</div>
			</div>
		</header>
	);
}
