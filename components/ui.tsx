"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
	primary: "bg-accent text-accent-text hover:bg-accent-hover border border-transparent",
	secondary: "bg-surface text-text border border-border-strong hover:bg-surface-2",
	ghost: "bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-text",
	danger: "bg-transparent text-danger border border-transparent hover:bg-danger-weak",
};

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
		<button
			type={type}
			disabled={disabled || busy}
			className={cx(
				"inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
				size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
				VARIANTS[variant],
				className,
			)}
			{...rest}
		>
			{busy && <Spinner />}
			{children}
		</button>
	);
}

export function Spinner({ className }: { className?: string }) {
	return (
		<svg className={cx("size-3.5 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
			<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		</svg>
	);
}

const FIELD = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60";

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
	return <input className={cx(FIELD, "h-9 py-0", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return <textarea className={cx(FIELD, "resize-y leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select className={cx(FIELD, "h-9 py-0 pr-8", className)} {...rest}>
			{children}
		</select>
	);
}

/** A labelled control. Without htmlFor the label wraps the control, so it is still associated. */
export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
	if (htmlFor) {
		return (
			<div className={cx("flex flex-col gap-1.5", className)}>
				<label htmlFor={htmlFor} className="text-[13px] font-medium text-text">
					{label}
				</label>
				{children}
				{hint && <p className="text-xs text-muted">{hint}</p>}
			</div>
		);
	}
	return (
		<label className={cx("flex flex-col gap-1.5", className)}>
			<span className="text-[13px] font-medium text-text">{label}</span>
			{children}
			{hint && <span className="text-xs text-muted">{hint}</span>}
		</label>
	);
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
		<span className="tabular-nums">
			{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
		</span>
	);
}

export function Notice({ tone = "error", children, className }: { tone?: "error" | "info" | "ok" | "warn"; children: ReactNode; className?: string }) {
	const tones = {
		error: "border-danger/40 bg-danger-weak text-danger",
		info: "border-border bg-surface-2 text-text",
		ok: "border-ok/30 bg-ok-weak text-ok",
		warn: "border-warn/30 bg-warn-weak text-warn",
	};
	return (
		<div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", tones[tone], className)}>
			{children}
		</div>
	);
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warn" | "danger" | "ok"; children: ReactNode }) {
	const tones = {
		neutral: "bg-surface-2 text-muted",
		accent: "bg-accent-weak text-accent",
		warn: "bg-warn-weak text-warn",
		danger: "bg-danger-weak text-danger",
		ok: "bg-ok-weak text-ok",
	};
	return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none", tones[tone])}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
	return (
		<header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
			<div className="min-w-0">
				<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
				{description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
			</div>
			{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
		</header>
	);
}

export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<section className={cx("mb-8", className)}>
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<h2 className="text-[15px] font-semibold">{title}</h2>
					{description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
				</div>
				{actions}
			</div>
			{children}
		</section>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{children}</div>;
}
