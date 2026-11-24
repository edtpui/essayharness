"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
	primary: "key key--primary",
	secondary: "key",
	ghost: "key key--quiet",
	danger: "key key--danger",
};

/** Keycap buttons: one cobalt primary per screen, key faces for the rest, quiet and danger as typography. */
export function Button({
	variant = "secondary",
	size = "md",
	busy = false,
	className,
	children,
	disabled,
	type = "button",
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
	return (
		<button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={cx(VARIANTS[variant], size === "sm" && "key--sm", className)} {...rest}>
			{busy && <Spinner />}
			{children}
		</button>
	);
}

export function Spinner({ className }: { className?: string }) {
	return (
		<svg aria-hidden="true" className={cx("size-3.5 animate-spin motion-reduce:animate-none", className)} viewBox="0 0 24 24" fill="none">
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
			<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		</svg>
	);
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
	return <input className={cx("field", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return <textarea className={cx("field", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select className={cx("field pr-8", className)} {...rest}>
			{children}
		</select>
	);
}

/** A labelled control. Without htmlFor the label wraps the control, so it is still associated. */
export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
	const text = <span className="font-display text-sm font-medium text-ink-2">{label}</span>;
	const help = hint && <span className="text-sm text-muted">{hint}</span>;
	if (htmlFor) {
		return (
			<div className={cx("flex flex-col gap-1.5", className)}>
				<label htmlFor={htmlFor}>{text}</label>
				{children}
				{help}
			</div>
		);
	}
	return (
		<label className={cx("flex flex-col gap-1.5", className)}>
			{text}
			{children}
			{help}
		</label>
	);
}

/** Messages: a hairline on the left in the tone's colour, never a filled box. */
export function Notice({ tone = "error", children, className }: { tone?: "error" | "info" | "ok" | "warn"; children: ReactNode; className?: string }) {
	const tones = {
		error: "border-error text-error bg-error-wash",
		info: "border-rule-2 text-ink-2 bg-paper-2",
		ok: "border-success text-success bg-success-wash",
		warn: "border-warn text-warn bg-warn-wash",
	};
	return (
		<div role={tone === "error" ? "alert" : "status"} className={cx("border-l-2 px-3 py-2 text-sm", tones[tone], className)}>
			{children}
		</div>
	);
}

/** Status is text, never a filled chip. */
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warn" | "danger" | "ok"; children: ReactNode }) {
	const tones = { neutral: "text-muted", accent: "text-accent", warn: "text-warn", danger: "text-error", ok: "text-success" };
	return <span className={cx("font-display text-sm font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
	return (
		<header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
			<div className="min-w-0">
				<h1>{title}</h1>
				{description && <p className="mt-2 max-w-2xl text-ink-2">{description}</p>}
			</div>
			{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
		</header>
	);
}

export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<section className={cx("mb-10", className)}>
			<div className="mb-3 flex flex-wrap items-end justify-between gap-2">
				<div className="min-w-0">
					<h2>{title}</h2>
					{description && <p className="mt-1 text-sm text-muted">{description}</p>}
				</div>
				{actions}
			</div>
			{children}
		</section>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return <div className="border border-dashed border-rule-2 px-4 py-8 text-center text-ink-2">{children}</div>;
}

/** Minutes and seconds since mount, for long model calls with no visible output yet. */
export function Elapsed() {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		const start = Date.now();
		const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
		return () => clearInterval(timer);
	}, []);
	return (
		<span className="mono">
			{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
		</span>
	);
}
