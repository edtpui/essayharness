import type { SVGProps } from "react";

const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function MicIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" {...base} {...props}>
			<rect x="9" y="3" width="6" height="11" rx="3" />
			<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
		</svg>
	);
}

export function StopIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" {...base} {...props}>
			<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}

export function ChevronIcon({ open, ...props }: SVGProps<SVGSVGElement> & { open?: boolean }) {
	return (
		<svg aria-hidden="true" {...base} {...props} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform var(--dur-micro) var(--ease-out)" }}>
			<path d="m9 6 6 6-6 6" />
		</svg>
	);
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" {...base} {...props}>
			<rect x="9" y="9" width="11" height="11" rx="2" />
			<path d="M5 15V6a2 2 0 0 1 2-2h9" />
		</svg>
	);
}
