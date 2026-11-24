"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-context";
import { cx } from "./ui";

const LINKS = [
	{ href: "/", label: "Capture", hint: "Dictate your experiences" },
	{ href: "/bank", label: "Experience bank", hint: "What you've told it" },
	{ href: "/graph", label: "Graph", hint: "How it all connects" },
	{ href: "/essays", label: "Essays", hint: "Plan, draft, revise" },
	{ href: "/settings", label: "Settings", hint: "Models, keys, usage" },
];

function isActive(pathname: string, href: string): boolean {
	return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
	const pathname = usePathname();
	const { view, loadError } = useApp();
	const needsKey = view && view.credentials[view.settings.mainModel.provider].source === "none" && view.settings.mainModel.provider !== "custom";

	return (
		<nav className="flex shrink-0 flex-col border-border bg-surface md:w-56 md:border-r">
			<div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
				<Link href="/" className="block font-semibold tracking-tight">
					Scholarship Essays
				</Link>
				<p className="hidden text-xs text-muted md:mt-0.5 md:block">Your experiences, your words</p>
			</div>
			<ul className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-0.5 md:pb-0">
				{LINKS.map((link) => (
					<li key={link.href}>
						<Link
							href={link.href}
							className={cx(
								"block rounded-md px-3 py-1.5 text-sm whitespace-nowrap md:py-2",
								isActive(pathname, link.href) ? "bg-accent-weak font-medium text-accent" : "text-text hover:bg-surface-2",
							)}
						>
							{link.label}
							<span className="hidden text-xs font-normal text-muted md:block">{link.hint}</span>
						</Link>
					</li>
				))}
			</ul>
			<div className="mt-auto hidden px-4 py-4 text-xs text-muted md:block">
				{loadError && <p className="text-danger">{loadError}</p>}
				{needsKey && (
					<p>
						<Link href="/settings" className="text-warn underline">
							Add an API key
						</Link>{" "}
						to start writing.
					</p>
				)}
				{view && !needsKey && <p className="truncate" title={view.settings.mainModel.model}>Model: {view.settings.mainModel.model}</p>}
			</div>
		</nav>
	);
}
