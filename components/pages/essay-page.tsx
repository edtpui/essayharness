"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, messageOf, streamGeneration } from "@/lib/api";
import type { Audit, Entry, Essay, Experience, Question, Version } from "@/lib/types";
import { countCharacters, countWords, formatDateTime, formatLimit, formatUsd, measure } from "@/lib/text";
import { BriefForm } from "../brief-form";
import { DictationField } from "../dictation";
import { ChevronIcon, CopyIcon } from "../icons";
import { Badge, Button, Elapsed, EmptyState, Notice, Section, TextArea, cx } from "../ui";
import { useLocalDraft } from "../use-local-draft";

type Busy = null | "plan" | "draft" | "revise" | "tighten" | "audit";

const RUN_LABEL: Record<string, string> = {
	plan: "Planning…",
	draft: "Writing a draft…",
	revise: "Revising…",
	tighten: "Cutting to the limit…",
	audit: "Checking facts…",
};

export function EssayPage({ id }: { id: string }) {
	const router = useRouter();
	const [essay, setEssay] = useState<Essay | null>(null);
	const [run, setRun] = useState<{ kind: string } | null>(null);
	const [cost, setCost] = useState(0);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [answers, setAnswers] = useState<Record<string, Entry>>({});
	const [error, setError] = useState<string | null>(null);
	const [missing, setMissing] = useState(false);
	const [busy, setBusy] = useState<Busy>(null);
	const [stream, setStream] = useState<string | null>(null);
	const [versionId, setVersionId] = useState<string | null>(null);
	const [editingBrief, setEditingBrief] = useState(false);

	const load = useCallback(async () => {
		try {
			const [data, exps, notes] = await Promise.all([
				api<{ essay: Essay; run: { kind: string } | null; costUsd: number }>(`/api/essays/${id}`),
				api<{ experiences: Experience[] }>("/api/experiences"),
				api<{ entries: Entry[] }>(`/api/entries?essayId=${id}`),
			]);
			setEssay(data.essay);
			setRun(data.run);
			setCost(data.costUsd);
			setTitles(Object.fromEntries(exps.experiences.map((e) => [e.id, e.title])));
			setAnswers(Object.fromEntries(notes.entries.map((e) => [e.id, e])));
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

	const withBusy = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
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

	const generate = async (mode: "draft" | "revise" | "tighten", instruction?: string): Promise<boolean> => {
		setBusy(mode);
		setError(null);
		setStream("");
		const result: { version?: Version; error?: string } = {};
		try {
			await streamGeneration(`/api/essays/${id}/generate`, { mode, instruction, baseVersionId: mode === "draft" ? undefined : selected?.id }, (event) => {
				if (event.type === "delta") setStream((s) => (s ?? "") + event.text);
				else if (event.type === "done") result.version = event.version;
				else result.error = event.message;
			});
		} catch (err) {
			result.error = messageOf(err);
		}
		setStream(null);
		setBusy(null);
		if (result.error && result.error !== "Stopped.") setError(result.error);
		await load();
		if (result.version) setVersionId(result.version.id);
		return Boolean(result.version);
	};

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
	const openQuestions = essay.questions.filter((q) => q.status === "open");

	return (
		<>
			<header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
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

			<div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
				<div className="min-w-0">
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

					<PlanPanel essay={essay} titles={titles} busy={busy === "plan"} disabled={working} onPlan={plan} onSelect={async (index) => {
						try {
							setEssay((await api<{ essay: Essay }>(`/api/essays/${id}/angle`, { method: "PUT", body: { index } })).essay);
						} catch (err) {
							setError(messageOf(err));
						}
					}} />

					<QuestionHistory essay={essay} answers={answers} onReopen={async (q) => {
						try {
							setEssay((await api<{ essay: Essay }>(`/api/essays/${id}/questions/${q.id}`, { method: "PATCH", body: { status: "open" } })).essay);
						} catch (err) {
							setError(messageOf(err));
						}
					}} />

					<div className="border-t border-border pt-4">
						<Button
							size="sm"
							variant="danger"
							disabled={working}
							onClick={async () => {
								if (!window.confirm(`Delete "${essay.title}" and all its drafts? Your answers stay in the experience bank.`)) return;
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

				<div className="min-w-0">
					{openQuestions.length > 0 && <QuestionDock essay={essay} questions={openQuestions} disabled={working} onChanged={load} onError={setError} />}

					{!essay.plan && busy !== "plan" && (
						<Notice tone="info" className="mb-6">
							<p className="font-medium">Start by planning.</p>
							<p className="mt-1 text-muted">
								The agent reads your experience bank against this prompt, proposes angles, and asks about anything the essay needs that you haven&apos;t told it yet.
							</p>
							<Button variant="primary" className="mt-3" onClick={plan} disabled={working}>
								Plan this essay
							</Button>
						</Notice>
					)}

					<DraftPanel
						essay={essay}
						selected={selected}
						stream={stream}
						busy={busy}
						disabled={working}
						onSelectVersion={setVersionId}
						onGenerate={generate}
						onStop={stop}
						onAudit={audit}
						onManualSave={async (text) => {
							const { essay: next } = await api<{ essay: Essay }>(`/api/essays/${id}/versions`, { body: { text } });
							setEssay(next);
							setVersionId(next.versions.at(-1)?.id ?? null);
						}}
					/>
				</div>
			</div>
		</>
	);
}

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
	return (
		<Section
			title="Plan"
			description={plan ? `Planned ${formatDateTime(plan.createdAt)} with ${plan.model}` : "Not planned yet."}
			actions={
				plan && (
					<Button size="sm" onClick={onPlan} busy={busy} disabled={disabled && !busy}>
						Re-plan
					</Button>
				)
			}
		>
			{busy && (
				<p className="mb-2 text-sm text-muted">
					Reading your bank against the prompt… <Elapsed />
				</p>
			)}
			{plan && (
				<div className="grid gap-3">
					<div className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm">
						<div className="mb-1">{plan.ready ? <Badge tone="ok">Enough material to draft</Badge> : <Badge tone="warn">Needs your answers first</Badge>}</div>
						<p>{plan.assessment}</p>
					</div>
					<fieldset className="grid gap-2">
						<legend className="mb-1 text-xs font-medium text-muted">Angles — the draft follows the selected one</legend>
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
												{index === plan.recommendedAngle && <span className="ml-2 align-middle"><Badge tone="accent">Recommended</Badge></span>}
											</p>
											<p className="mt-0.5 text-muted">{angle.pitch}</p>
											{active && angle.outline.length > 0 && (
												<ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px]">
													{angle.outline.map((beat, i) => (
														<li key={i}>
															{beat.beat}
															<ExperienceChips ids={beat.experienceIds} titles={titles} />
														</li>
													))}
												</ol>
											)}
										</div>
									</div>
								</label>
							);
						})}
					</fieldset>
				</div>
			)}
		</Section>
	);
}

function sortQuestions(questions: Question[]): Question[] {
	return [...questions].sort((a, b) => (a.priority === b.priority ? a.createdAt.localeCompare(b.createdAt) : a.priority === "critical" ? -1 : 1));
}

function QuestionDock({
	essay,
	questions,
	disabled,
	onChanged,
	onError,
}: {
	essay: Essay;
	questions: Question[];
	disabled: boolean;
	onChanged: () => Promise<void>;
	onError: (message: string) => void;
}) {
	const ordered = sortQuestions(questions);
	const current = ordered[0]!;
	const [answer, setAnswer] = useLocalDraft(`answer-${essay.id}-${current.id}`);
	const [busy, setBusy] = useState<null | "save" | "skip">(null);
	const [saved, setSaved] = useState<string | null>(null);

	const save = async () => {
		setBusy("save");
		setSaved(null);
		try {
			const { entry } = await api<{ entry: Entry }>("/api/entries", {
				body: { text: answer, source: "interview", essayId: essay.id, questionId: current.id, extract: false },
			});
			setAnswer("");
			setSaved("Saved to your bank.");
			// Sorting runs in the background; the draft reads the answer text directly either way.
			void api(`/api/entries/${entry.id}/extract`, { method: "POST" }).catch(() => undefined);
			await onChanged();
		} catch (err) {
			onError(messageOf(err));
		} finally {
			setBusy(null);
		}
	};

	const skip = async () => {
		setBusy("skip");
		try {
			await api(`/api/essays/${essay.id}/questions/${current.id}`, { method: "PATCH", body: { status: "skipped" } });
			await onChanged();
		} catch (err) {
			onError(messageOf(err));
		} finally {
			setBusy(null);
		}
	};

	return (
		<section className="mb-6 rounded-lg border border-accent/40 bg-surface p-4">
			<div className="mb-2 flex items-center justify-between gap-2">
				<h2 className="text-[15px] font-semibold">The agent has a question</h2>
				<span className="text-xs text-muted">
					{ordered.length} open · {current.priority === "critical" ? "needed for this angle" : "would strengthen it"}
				</span>
			</div>
			<p className="text-[15px]">{current.question}</p>
			{current.why && <p className="mt-1 text-[13px] text-muted">{current.why}</p>}
			<div className="mt-3">
				<DictationField
					value={answer}
					onChange={setAnswer}
					rows={4}
					placeholder="Dictate or type your answer. Specifics help: what you saw, said, did."
					aria-label="Your answer"
					disabled={busy !== null}
					footer={
						<>
							<Button variant="ghost" onClick={skip} busy={busy === "skip"} disabled={busy !== null}>
								Skip
							</Button>
							<Button variant="primary" onClick={save} busy={busy === "save"} disabled={!answer.trim() || busy !== null}>
								Save answer
							</Button>
						</>
					}
				/>
			</div>
			{saved && <p className="mt-2 text-xs text-ok">{saved}</p>}
			{ordered.length === 1 && !disabled && <p className="mt-2 text-xs text-muted">Last question. After it, re-plan to let the agent check for anything else, or write the draft.</p>}
		</section>
	);
}

function QuestionHistory({ essay, answers, onReopen }: { essay: Essay; answers: Record<string, Entry>; onReopen: (q: Question) => void }) {
	const [open, setOpen] = useState(false);
	const done = essay.questions.filter((q) => q.status !== "open");
	if (!done.length) return null;
	const answered = done.filter((q) => q.status === "answered").length;
	return (
		<Section title="Answered questions" description={`${answered} answered, ${done.length - answered} skipped`}>
			<button type="button" onClick={() => setOpen((o) => !o)} className="mb-2 flex items-center gap-1 text-xs text-muted hover:text-text">
				<ChevronIcon open={open} width={12} height={12} />
				{open ? "Hide" : "Show"}
			</button>
			{open && (
				<ul className="divide-y divide-border rounded-md border border-border bg-surface text-sm">
					{done.map((q) => (
						<li key={q.id} className="px-3 py-2.5">
							<p className="font-medium">{q.question}</p>
							{q.status === "answered" ? (
								<p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted">{(q.entryId && answers[q.entryId]?.text) || "(answer saved)"}</p>
							) : (
								<p className="mt-1 text-xs text-muted">
									Skipped ·{" "}
									<button type="button" className="underline" onClick={() => onReopen(q)}>
										Answer it after all
									</button>
								</p>
							)}
						</li>
					))}
				</ul>
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
	disabled,
	onSelectVersion,
	onGenerate,
	onStop,
	onAudit,
	onManualSave,
}: {
	essay: Essay;
	selected: Version | null;
	stream: string | null;
	busy: Busy;
	disabled: boolean;
	onSelectVersion: (id: string) => void;
	onGenerate: (mode: "draft" | "revise" | "tighten", instruction?: string) => Promise<boolean>;
	onStop: () => void;
	onAudit: () => void;
	onManualSave: (text: string) => Promise<void>;
}) {
	const [feedback, setFeedback] = useLocalDraft(`feedback-${essay.id}`);
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
					{RUN_LABEL[busy ?? "draft"]} <Elapsed />
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
				<EmptyState>
					<p>No draft yet.</p>
					<Button variant={essay.plan ? "primary" : "secondary"} className="mt-3" onClick={() => onGenerate("draft")} disabled={disabled}>
						{essay.plan ? "Write the draft" : "Draft without a plan"}
					</Button>
					{essay.plan && essay.questions.some((q) => q.status === "open" && q.priority === "critical") && (
						<p className="mt-2 text-xs text-warn">Some questions the agent marked as needed are still open.</p>
					)}
				</EmptyState>
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
				<div className="flex flex-wrap items-center gap-2">
					<select
						value={selected.id}
						onChange={(e) => onSelectVersion(e.target.value)}
						className="h-7 rounded-md border border-border bg-surface px-2 text-xs"
						aria-label="Version"
					>
						{[...versions].reverse().map((v, i) => (
							<option key={v.id} value={v.id}>
								v{versions.length - i} · {KIND_LABEL[v.kind]} · {formatDateTime(v.createdAt)}
							</option>
						))}
					</select>
					<Button size="sm" variant="ghost" onClick={() => onGenerate("draft")} disabled={disabled}>
						Fresh draft
					</Button>
				</div>
			}
		>
			<div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
				<LengthMeter text={selected.text} essay={essay} />
				{selected.angle && <span className="text-xs text-muted">Angle: {selected.angle}</span>}
				{selected.instruction && <span className="truncate text-xs text-muted" title={selected.instruction}>Asked: “{selected.instruction}”</span>}
				{!isLatest && <Badge tone="warn">Older version</Badge>}
			</div>

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
							<Button size="sm" variant="primary" onClick={() => onGenerate("tighten")} disabled={disabled}>
								Cut to {essay.limit.value} {essay.limit.unit}
							</Button>
						)}
					</div>
					{saveError && <Notice className="mt-2">{saveError}</Notice>}
				</>
			)}

			{audit && <AuditView audit={audit} />}
			{essay.audit && !audit && <p className="mt-3 text-xs text-muted">The last fact check was for a different version.</p>}

			{!editing && (
				<div className="mt-6">
					<h3 className="mb-1 text-sm font-semibold">Revise</h3>
					<p className="mb-2 text-xs text-muted">
						Say what to change, in your own words: “open with the night shift”, “less about grades, more about my brother”, “make the ending less neat”.
						{!isLatest && " This revises the version shown."}
					</p>
					<DictationField
						value={feedback}
						onChange={setFeedback}
						rows={3}
						aria-label="What to change"
						disabled={disabled}
						footer={
							<Button
								variant="primary"
								onClick={async () => {
									if (await onGenerate("revise", feedback)) setFeedback("");
								}}
								disabled={disabled || !feedback.trim()}
							>
								Revise
							</Button>
						}
					/>
				</div>
			)}
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
			<p className="mt-3 text-xs text-muted">Checked {formatDateTime(audit.createdAt)} with {audit.model}. Fix issues with Revise or Edit, or add the missing facts in Capture.</p>
		</div>
	);
}
