"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, messageOf, streamGeneration, streamNdjson } from "@/lib/api";
import type { Audit, ChatEvent, ChatMessage, Essay, Experience, Question, Version } from "@/lib/types";
import { countCharacters, countWords, formatDateTime, formatLimit, formatUsd, measure } from "@/lib/text";
import { BriefForm } from "../brief-form";
import { DictationField } from "../dictation";
import { ChevronIcon, CopyIcon } from "../icons";
import { Badge, Button, Elapsed, EmptyState, Notice, Section, TextArea, cx } from "../ui";
import { useLocalDraft } from "../use-local-draft";

type Busy = null | "chat" | "plan" | "tighten" | "audit";

const RUN_LABEL: Record<string, string> = {
	chat: "Working on your message…",
	plan: "Planning…",
	draft: "Writing a draft…",
	revise: "Revising…",
	tighten: "Cutting to the limit…",
	audit: "Checking facts…",
};

function upsertMessage(essay: Essay, message: ChatMessage): Essay {
	const exists = essay.messages.some((m) => m.id === message.id);
	return { ...essay, messages: exists ? essay.messages.map((m) => (m.id === message.id ? message : m)) : [...essay.messages, message] };
}

export function EssayPage({ id }: { id: string }) {
	const router = useRouter();
	const [essay, setEssay] = useState<Essay | null>(null);
	const [run, setRun] = useState<{ kind: string } | null>(null);
	const [cost, setCost] = useState(0);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [missing, setMissing] = useState(false);
	const [busy, setBusy] = useState<Busy>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [stream, setStream] = useState<string | null>(null);
	const [versionId, setVersionId] = useState<string | null>(null);
	const [editingBrief, setEditingBrief] = useState(false);

	const load = useCallback(async () => {
		try {
			const [data, exps] = await Promise.all([
				api<{ essay: Essay; run: { kind: string } | null; costUsd: number }>(`/api/essays/${id}`),
				api<{ experiences: Experience[] }>("/api/experiences"),
			]);
			setEssay(data.essay);
			setRun(data.run);
			setCost(data.costUsd);
			setTitles(Object.fromEntries(exps.experiences.map((e) => [e.id, e.title])));
			setError(null);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) setMissing(true);
			else setError(messageOf(err));
		}
	}, [id]);

	useEffect(() => {
		void load();
	}, [load]);

	// A run started before a reload (or in another tab) keeps going on the server; follow it.
	useEffect(() => {
		if (!run || busy) return;
		const timer = setInterval(() => void load(), 3000);
		return () => clearInterval(timer);
	}, [run, busy, load]);

	const versions = essay?.versions ?? [];
	const selected = versions.find((v) => v.id === versionId) ?? versions.at(-1) ?? null;

	const send = async (text: string, onAccepted: () => void): Promise<void> => {
		setBusy("chat");
		setError(null);
		setStatus("Sending…");
		setStream(null);
		try {
			await streamNdjson<ChatEvent>(`/api/essays/${id}/chat`, { text }, (event) => {
				switch (event.type) {
					case "message":
						if (event.message.role === "user") onAccepted();
						setEssay((e) => (e ? upsertMessage(e, event.message) : e));
						break;
					case "status":
						setStatus(event.text);
						break;
					case "delta":
						setStream((s) => (s ?? "") + event.text);
						break;
					case "version":
						setStream(null);
						setVersionId(event.version.id);
						break;
					case "essay":
						setEssay(event.essay);
						break;
					case "error":
						if (event.message !== "Stopped.") setError(event.message);
						break;
				}
			});
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(null);
			setStatus(null);
			setStream(null);
			await load();
		}
	};

	const withBusy = async (kind: Exclude<Busy, null | "chat">, fn: () => Promise<void>) => {
		setBusy(kind);
		setError(null);
		try {
			await fn();
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(null);
		}
	};

	const plan = () =>
		withBusy("plan", async () => {
			setEssay((await api<{ essay: Essay }>(`/api/essays/${id}/plan`, { method: "POST" })).essay);
		});

	const audit = () =>
		withBusy("audit", async () => {
			setEssay((await api<{ essay: Essay }>(`/api/essays/${id}/audit`, { body: { versionId: selected?.id } })).essay);
		});

	const tighten = () =>
		withBusy("tighten", async () => {
			setStream("");
			const result: { version?: Version; error?: string } = {};
			await streamGeneration(`/api/essays/${id}/generate`, { mode: "tighten", baseVersionId: selected?.id }, (event) => {
				if (event.type === "delta") setStream((s) => (s ?? "") + event.text);
				else if (event.type === "done") result.version = event.version;
				else result.error = event.message;
			});
			setStream(null);
			await load();
			if (result.version) setVersionId(result.version.id);
			if (result.error && result.error !== "Stopped.") throw new Error(result.error);
		});

	const stop = async () => {
		try {
			await api(`/api/essays/${id}/stop`, { method: "POST" });
		} catch (err) {
			setError(messageOf(err));
		}
	};

	if (missing) {
		return (
			<EmptyState>
				This essay no longer exists. <Link href="/essays" className="underline">Back to essays</Link>
			</EmptyState>
		);
	}
	if (!essay) return error ? <Notice>{error}</Notice> : <p className="text-sm text-muted">Loading…</p>;

	const working = busy !== null || run !== null;

	return (
		<>
			<header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
				<div className="min-w-0">
					<Link href="/essays" className="text-xs text-muted hover:text-text">
						← Essays
					</Link>
					<h1 className="mt-1 text-xl font-semibold tracking-tight">{essay.title}</h1>
					<p className="mt-1 text-sm text-muted">{[essay.scholarship, formatLimit(essay.limit)].filter(Boolean).join(" · ")}</p>
				</div>
				<div className="flex items-center gap-3 text-xs text-muted">
					{cost > 0 && <span title="Estimated from list prices">≈ {formatUsd(cost)} spent on this essay</span>}
					{run && !busy && (
						<span className="flex items-center gap-2">
							<Badge tone="warn">{RUN_LABEL[run.kind] ?? "Working…"}</Badge>
							<Button size="sm" variant="ghost" onClick={stop}>
								Stop
							</Button>
						</span>
					)}
				</div>
			</header>

			{error && (
				<Notice className="mb-4">
					{error}
					{error.includes("Settings") && (
						<>
							{" "}
							<Link href="/settings" className="underline">
								Open Settings
							</Link>
						</>
					)}
				</Notice>
			)}

			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<ChatPanel essay={essay} busy={busy === "chat"} disabled={working && busy !== "chat"} status={status} onSend={send} onStop={stop} onShowVersion={setVersionId} />

				<div className="min-w-0">
					<DraftPanel
						essay={essay}
						selected={selected}
						stream={stream}
						busy={busy}
						status={status}
						disabled={working}
						onSelectVersion={setVersionId}
						onTighten={tighten}
						onStop={stop}
						onAudit={audit}
						onManualSave={async (text) => {
							const { essay: next } = await api<{ essay: Essay }>(`/api/essays/${id}/versions`, { body: { text } });
							setEssay(next);
							setVersionId(next.versions.at(-1)?.id ?? null);
						}}
					/>

					<PlanPanel
						essay={essay}
						titles={titles}
						busy={busy === "plan"}
						disabled={working}
						onPlan={plan}
						onSelect={async (index) => {
							try {
								setEssay((await api<{ essay: Essay }>(`/api/essays/${id}/angle`, { method: "PUT", body: { index } })).essay);
							} catch (err) {
								setError(messageOf(err));
							}
						}}
					/>

					<QuestionList
						essay={essay}
						onStatus={async (q, next) => {
							try {
								setEssay((await api<{ essay: Essay }>(`/api/essays/${id}/questions/${q.id}`, { method: "PATCH", body: { status: next } })).essay);
							} catch (err) {
								setError(messageOf(err));
							}
						}}
					/>

					<Section
						title="Brief"
						actions={
							!editingBrief && (
								<Button size="sm" variant="ghost" onClick={() => setEditingBrief(true)} disabled={working}>
									Edit
								</Button>
							)
						}
					>
						{editingBrief ? (
							<div className="rounded-md border border-border bg-surface p-3">
								<BriefForm
									initial={essay}
									submitLabel="Save brief"
									onCancel={() => setEditingBrief(false)}
									onSubmit={async (input) => {
										setEssay((await api<{ essay: Essay }>(`/api/essays/${id}`, { method: "PATCH", body: input })).essay);
										setEditingBrief(false);
									}}
								/>
							</div>
						) : (
							<BriefView essay={essay} />
						)}
					</Section>

					<div className="border-t border-border pt-4">
						<Button
							size="sm"
							variant="danger"
							disabled={working}
							onClick={async () => {
								if (!window.confirm(`Delete "${essay.title}", its chat and all its drafts? What you told it stays in your experience bank.`)) return;
								try {
									await api(`/api/essays/${id}`, { method: "DELETE" });
									router.push("/essays");
								} catch (err) {
									setError(messageOf(err));
								}
							}}
						>
							Delete essay
						</Button>
					</div>
				</div>
			</div>
		</>
	);
}

/* ---------- chat ---------- */

const SUGGESTIONS = [
	{ label: "Plan this essay", text: "Plan this essay. What angles do I have, and what do you need from me?" },
	{ label: "Write a first draft", text: "Write a first draft from what you already know about me." },
	{ label: "Tell it a story", text: "Here's a story I want to use: " },
];

function ChatPanel({
	essay,
	busy,
	disabled,
	status,
	onSend,
	onStop,
	onShowVersion,
}: {
	essay: Essay;
	busy: boolean;
	disabled: boolean;
	status: string | null;
	onSend: (text: string, onAccepted: () => void) => Promise<void>;
	onStop: () => void;
	onShowVersion: (versionId: string) => void;
}) {
	const [text, setText] = useLocalDraft(`chat-${essay.id}`);
	const listRef = useRef<HTMLDivElement>(null);
	const versionNumber = useMemo(() => new Map(essay.versions.map((v, i) => [v.id, i + 1])), [essay.versions]);

	useEffect(() => {
		const el = listRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [essay.messages.length, status, busy]);

	const submit = () => {
		const body = text.trim();
		if (!body || busy || disabled) return;
		void onSend(body, () => setText(""));
	};

	return (
		<section className="flex min-w-0 flex-col rounded-lg border border-border bg-surface lg:sticky lg:top-6 lg:h-[calc(100vh-9rem)]">
			<div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
				{essay.messages.length === 0 && (
					<div className="text-sm">
						<p>
							Tell me about this essay, or anything you want in it. What you tell me goes into your experience bank, I&apos;ll ask about what&apos;s
							missing, and I&apos;ll write and rework the draft as we go.
						</p>
						<div className="mt-3 flex flex-wrap gap-2">
							{SUGGESTIONS.map((s) => (
								<Button
									key={s.label}
									size="sm"
									disabled={busy || disabled}
									onClick={() => (s.text.endsWith(": ") ? setText(s.text) : void onSend(s.text, () => undefined))}
								>
									{s.label}
								</Button>
							))}
						</div>
					</div>
				)}
				{essay.messages.map((m) =>
					m.role === "user" ? (
						<div key={m.id} className="flex flex-col items-end">
							<p className="max-w-[85%] rounded-lg bg-accent-weak px-3 py-2 text-sm whitespace-pre-wrap">{m.text}</p>
							{m.entryId && <span className="mt-1 text-[11px] text-muted">Saved to your bank</span>}
						</div>
					) : (
						<div key={m.id} className="max-w-[95%] text-sm">
							<p className="whitespace-pre-wrap">{m.text}</p>
							<div className="mt-1 flex flex-wrap items-center gap-2">
								{m.versionId && versionNumber.has(m.versionId) && (
									<button type="button" className="text-xs text-accent underline" onClick={() => onShowVersion(m.versionId!)}>
										Show draft v{versionNumber.get(m.versionId)}
									</button>
								)}
								{m.error && <span className="text-xs text-danger">{m.error}</span>}
							</div>
						</div>
					),
				)}
				{busy && status && (
					<p className="text-xs text-muted">
						{status} <Elapsed />
					</p>
				)}
			</div>
			<div className="border-t border-border p-3">
				<DictationField
					value={text}
					onChange={setText}
					rows={3}
					micSize="sm"
					placeholder="Dictate or type: a story, a detail you forgot, or what to change in the draft. Ctrl+Enter sends."
					aria-label="Message"
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							submit();
						}
					}}
					footer={
						busy ? (
							<Button variant="ghost" onClick={onStop}>
								Stop
							</Button>
						) : (
							<Button variant="primary" onClick={submit} disabled={!text.trim() || disabled}>
								Send
							</Button>
						)
					}
				/>
			</div>
		</section>
	);
}

/* ---------- side panels ---------- */

function BriefView({ essay }: { essay: Essay }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded-md border border-border bg-surface px-3 py-3 text-sm">
			<p className="whitespace-pre-wrap">{essay.prompt}</p>
			{(essay.criteria || essay.notes) && (
				<>
					<button type="button" className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
						<ChevronIcon open={open} width={12} height={12} />
						Criteria and notes
					</button>
					{open && (
						<div className="mt-2 grid gap-2 text-[13px]">
							{essay.criteria && (
								<div>
									<p className="text-xs font-medium text-muted">Selection criteria</p>
									<p className="whitespace-pre-wrap">{essay.criteria}</p>
								</div>
							)}
							{essay.notes && (
								<div>
									<p className="text-xs font-medium text-muted">Your notes</p>
									<p className="whitespace-pre-wrap">{essay.notes}</p>
								</div>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}

function ExperienceChips({ ids, titles }: { ids: string[]; titles: Record<string, string> }) {
	if (!ids.length) return null;
	return (
		<span className="mt-1 flex flex-wrap gap-1">
			{ids.map((expId) => (
				<Link key={expId} href={`/bank#${expId}`} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted hover:text-text">
					{titles[expId] ?? "experience"}
				</Link>
			))}
		</span>
	);
}

function PlanPanel({
	essay,
	titles,
	busy,
	disabled,
	onPlan,
	onSelect,
}: {
	essay: Essay;
	titles: Record<string, string>;
	busy: boolean;
	disabled: boolean;
	onPlan: () => void;
	onSelect: (index: number) => void;
}) {
	const plan = essay.plan;
	const [open, setOpen] = useState(false);
	return (
		<Section
			title="Plan"
			description={plan ? `${plan.ready ? "Enough material to draft" : "Needs more from you"} · planned ${formatDateTime(plan.createdAt)}` : "Not planned yet — ask in the chat, or plan here."}
			actions={
				<Button size="sm" onClick={onPlan} busy={busy} disabled={disabled && !busy}>
					{plan ? "Re-plan" : "Plan"}
				</Button>
			}
		>
			{busy && (
				<p className="mb-2 text-sm text-muted">
					Reading your bank against the prompt… <Elapsed />
				</p>
			)}
			{plan && (
				<fieldset className="grid gap-2">
					<legend className="mb-1 text-xs text-muted">The draft follows the selected angle.</legend>
					{plan.angles.map((angle, index) => {
						const active = index === essay.selectedAngle;
						return (
							<label
								key={`${angle.title}-${index}`}
								className={cx("block cursor-pointer rounded-md border px-3 py-2.5 text-sm", active ? "border-accent bg-accent-weak/50" : "border-border bg-surface hover:bg-surface-2")}
							>
								<div className="flex items-start gap-2">
									<input type="radio" name="angle" checked={active} onChange={() => onSelect(index)} disabled={disabled} className="mt-1" />
									<div className="min-w-0">
										<p className="font-medium">
											{angle.title}
											{index === plan.recommendedAngle && (
												<span className="ml-2 align-middle">
													<Badge tone="accent">Recommended</Badge>
												</span>
											)}
										</p>
										<p className="mt-0.5 text-muted">{angle.pitch}</p>
										{active && angle.outline.length > 0 && (
											<>
												<button type="button" className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-text" onClick={(e) => (e.preventDefault(), setOpen((o) => !o))}>
													<ChevronIcon open={open} width={12} height={12} />
													Outline
												</button>
												{open && (
													<ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px]">
														{angle.outline.map((beat, i) => (
															<li key={i}>
																{beat.beat}
																<ExperienceChips ids={beat.experienceIds} titles={titles} />
															</li>
														))}
													</ol>
												)}
											</>
										)}
									</div>
								</div>
							</label>
						);
					})}
				</fieldset>
			)}
		</Section>
	);
}

function QuestionList({ essay, onStatus }: { essay: Essay; onStatus: (q: Question, status: "open" | "skipped") => void }) {
	if (!essay.questions.length) return null;
	const open = essay.questions.filter((q) => q.status === "open");
	const answered = essay.questions.filter((q) => q.status === "answered").length;
	const skipped = essay.questions.filter((q) => q.status === "skipped");
	return (
		<Section title="Questions" description={`${open.length} open · ${answered} answered${skipped.length ? ` · ${skipped.length} skipped` : ""}. Answer them in the chat, in your own words.`}>
			{open.length > 0 && (
				<ul className="divide-y divide-border rounded-md border border-border bg-surface text-sm">
					{open.map((q) => (
						<li key={q.id} className="flex items-start gap-2 px-3 py-2">
							<div className="min-w-0 flex-1">
								<p>{q.question}</p>
								{q.priority === "critical" && <Badge tone="warn">Needed for this angle</Badge>}
							</div>
							<Button size="sm" variant="ghost" onClick={() => onStatus(q, "skipped")}>
								Skip
							</Button>
						</li>
					))}
				</ul>
			)}
			{skipped.length > 0 && (
				<p className="mt-2 text-xs text-muted">
					Skipped:{" "}
					{skipped.map((q, i) => (
						<span key={q.id}>
							{i > 0 && " · "}
							<button type="button" className="underline" onClick={() => onStatus(q, "open")} title="Reopen">
								{q.question.length > 60 ? `${q.question.slice(0, 60)}…` : q.question}
							</button>
						</span>
					))}
				</p>
			)}
		</Section>
	);
}

/** Splits text into plain and highlighted runs for the audit's excerpts. */
function highlight(text: string, excerpts: string[]): ReactNode[] {
	const ranges: [number, number][] = [];
	for (const excerpt of excerpts) {
		const at = text.indexOf(excerpt);
		if (at !== -1) ranges.push([at, at + excerpt.length]);
	}
	ranges.sort((a, b) => a[0] - b[0]);
	const out: ReactNode[] = [];
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (start < cursor) continue;
		if (start > cursor) out.push(text.slice(cursor, start));
		out.push(<mark key={start}>{text.slice(start, end)}</mark>);
		cursor = end;
	}
	if (cursor < text.length) out.push(text.slice(cursor));
	return out;
}

const KIND_LABEL: Record<Version["kind"], string> = { draft: "Draft", revision: "Revision", tighten: "Cut to limit", manual: "Your edit" };

function LengthMeter({ text, essay }: { text: string; essay: Essay }) {
	const { count, unit, over } = measure(text, essay.limit);
	const limit = essay.limit;
	const near = limit && !over && count >= limit.value * 0.9;
	return (
		<span className={cx("text-xs tabular-nums", over ? "font-medium text-danger" : near ? "text-ok" : "text-muted")}>
			{count.toLocaleString()}
			{limit ? ` / ${limit.value.toLocaleString()}` : ""} {unit}
			{unit === "words" ? ` · ${countCharacters(text).toLocaleString()} characters` : ` · ${countWords(text).toLocaleString()} words`}
		</span>
	);
}

function DraftPanel({
	essay,
	selected,
	stream,
	busy,
	status,
	disabled,
	onSelectVersion,
	onTighten,
	onStop,
	onAudit,
	onManualSave,
}: {
	essay: Essay;
	selected: Version | null;
	stream: string | null;
	busy: Busy;
	status: string | null;
	disabled: boolean;
	onSelectVersion: (id: string) => void;
	onTighten: () => void;
	onStop: () => void;
	onAudit: () => void;
	onManualSave: (text: string) => Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const [copied, setCopied] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const versions = essay.versions;
	const audit: Audit | null = essay.audit && selected && essay.audit.versionId === selected.id ? essay.audit : null;
	const marked = useMemo(() => (selected && audit ? highlight(selected.text, audit.issues.map((i) => i.excerpt)) : null), [selected, audit]);

	if (stream !== null) {
		return (
			<Section title="Draft" actions={<Button size="sm" variant="ghost" onClick={onStop}>Stop</Button>}>
				<p className="mb-2 text-xs text-muted">
					{status ?? RUN_LABEL[busy ?? "draft"]} <Elapsed />
					{!stream && " · the model may think for a while before any text appears"}
				</p>
				<div className="rounded-md border border-border bg-surface px-5 py-4">
					<p className="essay-text caret">{stream.replace(/^\s+/, "")}</p>
				</div>
				<LengthMeter text={stream} essay={essay} />
			</Section>
		);
	}

	if (!selected) {
		return (
			<Section title="Draft">
				<EmptyState>No draft yet. Ask for one in the chat whenever you&apos;re ready.</EmptyState>
			</Section>
		);
	}

	const isLatest = selected.id === versions.at(-1)?.id;
	const over = measure(selected.text, essay.limit).over;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(selected.text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			setSaveError("The browser blocked clipboard access. Select the text and copy it instead.");
		}
	};

	return (
		<Section
			title="Draft"
			actions={
				<select value={selected.id} onChange={(e) => onSelectVersion(e.target.value)} className="h-7 rounded-md border border-border bg-surface px-2 text-xs" aria-label="Version">
					{[...versions].reverse().map((v, i) => (
						<option key={v.id} value={v.id}>
							v{versions.length - i} · {KIND_LABEL[v.kind]} · {formatDateTime(v.createdAt)}
						</option>
					))}
				</select>
			}
		>
			<div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
				<LengthMeter text={selected.text} essay={essay} />
				{selected.angle && <span className="text-xs text-muted">Angle: {selected.angle}</span>}
				{!isLatest && <Badge tone="warn">Older version — the chat revises the latest</Badge>}
			</div>
			{selected.instruction && <p className="mb-2 line-clamp-2 text-xs text-muted" title={selected.instruction}>Change: {selected.instruction}</p>}

			{editing ? (
				<div className="grid gap-2">
					<TextArea value={editText} onChange={(e) => setEditText(e.target.value)} rows={18} className="essay-text" />
					<LengthMeter text={editText} essay={essay} />
					{saveError && <Notice>{saveError}</Notice>}
					<div className="flex gap-2">
						<Button
							variant="primary"
							onClick={async () => {
								setSaveError(null);
								try {
									await onManualSave(editText);
									setEditing(false);
								} catch (err) {
									setSaveError(messageOf(err));
								}
							}}
						>
							Save as new version
						</Button>
						<Button variant="ghost" onClick={() => setEditing(false)}>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<>
					<div className="rounded-md border border-border bg-surface px-5 py-4">
						<p className="essay-text">{marked ?? selected.text}</p>
					</div>
					<div className="mt-2 flex flex-wrap gap-2">
						<Button size="sm" onClick={copy}>
							<CopyIcon width={14} height={14} />
							{copied ? "Copied" : "Copy"}
						</Button>
						<Button
							size="sm"
							onClick={() => {
								setEditText(selected.text);
								setEditing(true);
							}}
							disabled={disabled}
						>
							Edit
						</Button>
						<Button size="sm" onClick={onAudit} busy={busy === "audit"} disabled={disabled && busy !== "audit"}>
							Check facts
						</Button>
						{over && essay.limit && (
							<Button size="sm" variant="primary" onClick={onTighten} disabled={disabled}>
								Cut to {essay.limit.value} {essay.limit.unit}
							</Button>
						)}
					</div>
					{saveError && <Notice className="mt-2">{saveError}</Notice>}
				</>
			)}

			{audit && <AuditView audit={audit} />}
			{essay.audit && !audit && <p className="mt-3 text-xs text-muted">The last fact check was for a different version.</p>}
		</Section>
	);
}

const PROBLEM_LABEL = { unsupported: "Not in your material", embellished: "Goes beyond what you said", contradiction: "Contradicts your material" } as const;

function AuditView({ audit }: { audit: Audit }) {
	return (
		<div className="mt-4 rounded-md border border-border bg-surface px-3 py-3">
			<div className="mb-2 flex items-center gap-2">
				<h3 className="text-sm font-semibold">Fact check</h3>
				{audit.issues.length === 0 ? <Badge tone="ok">No problems found</Badge> : <Badge tone="warn">{audit.issues.length} to review</Badge>}
			</div>
			<p className="text-sm text-muted">{audit.summary}</p>
			{audit.issues.length > 0 && (
				<ul className="mt-3 grid gap-3">
					{audit.issues.map((issue, i) => (
						<li key={i} className="border-l-2 border-warn pl-3 text-sm">
							<p className="essay-text text-[15px]">“{issue.excerpt}”</p>
							<p className="mt-1">
								<Badge tone="warn">{PROBLEM_LABEL[issue.problem]}</Badge> <span className="text-muted">{issue.explanation}</span>
							</p>
							{issue.suggestion && <p className="mt-1 text-[13px]">Suggestion: {issue.suggestion}</p>}
						</li>
					))}
				</ul>
			)}
			<p className="mt-3 text-xs text-muted">Checked {formatDateTime(audit.createdAt)} with {audit.model}. Tell the chat what&apos;s actually true and it will fix the draft.</p>
		</div>
	);
}
