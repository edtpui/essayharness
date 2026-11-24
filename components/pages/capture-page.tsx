"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, messageOf } from "@/lib/api";
import type { Entry, Experience, Interview } from "@/lib/types";
import { formatDateTime } from "@/lib/text";
import { DictationField } from "../dictation";
import { ChevronIcon } from "../icons";
import { Badge, Button, EmptyState, Notice, PageHeader, Section, TextArea, cx } from "../ui";

const STARTERS = [
	"Tell me about a time you faced a real setback. What happened, and what did you do next?",
	"Who has shaped who you are? Tell one specific story about them.",
	"Describe a time you took the lead on something without being asked.",
	"What community do you belong to, and what have you done for it?",
	"What do you want to study, and when did you first get pulled toward it?",
	"Walk me through your responsibilities outside school: work, family, caregiving.",
	"What achievement are you proudest of? What did it take?",
	"Tell me about a mistake or failure and what changed afterwards.",
	"Where do you want to be in ten years, and why does it matter to you?",
	"What about your background or identity do people not see at first?",
	"What problem in your community would you most like to help solve?",
	"Have financial circumstances shaped your education or your choices? How?",
];

const DRAFT_KEY = "capture-draft-v1";

interface Draft {
	text: string;
	prompt: string;
	interviewQuestionId: string | null;
	dictated: boolean;
}

const EMPTY_DRAFT: Draft = { text: "", prompt: "", interviewQuestionId: null, dictated: false };

function loadDraft(): Draft {
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY_DRAFT;
	} catch {
		return EMPTY_DRAFT;
	}
}

function storeDraft(draft: Draft) {
	try {
		if (draft.text.trim() || draft.prompt) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
		else localStorage.removeItem(DRAFT_KEY);
	} catch {
		// storage unavailable: the draft just isn't kept across reloads
	}
}

export function CapturePage() {
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
	const [restored, setRestored] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [savedNote, setSavedNote] = useState<string | null>(null);
	const [entries, setEntries] = useState<Entry[] | null>(null);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [interview, setInterview] = useState<Interview | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [sorting, setSorting] = useState<Set<string>>(new Set());
	const boxRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setDraft(loadDraft());
		setRestored(true);
	}, []);
	useEffect(() => {
		if (restored) storeDraft(draft);
	}, [draft, restored]);

	const load = useCallback(async () => {
		try {
			const [e, x, iv] = await Promise.all([
				api<{ entries: Entry[] }>("/api/entries"),
				api<{ experiences: Experience[] }>("/api/experiences"),
				api<{ interview: Interview }>("/api/interview"),
			]);
			setEntries(e.entries);
			setTitles(Object.fromEntries(x.experiences.map((exp) => [exp.id, exp.title])));
			setInterview(iv.interview);
			setLoadError(null);
		} catch (err) {
			setLoadError(messageOf(err));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Keep statuses fresh while anything is being sorted.
	const busy =
		sorting.size > 0 ||
		(entries ?? []).some((e) => e.extraction.status === "running" || e.review?.status === "running" || e.review?.status === "pending" || (e.source === "import" && e.extraction.status === "pending"));
	useEffect(() => {
		if (!busy) return;
		const timer = setInterval(() => void load(), 3000);
		return () => clearInterval(timer);
	}, [busy, load]);

	const sort = useCallback(
		(id: string) => {
			setSorting((s) => new Set(s).add(id));
			api(`/api/entries/${id}/extract`, { method: "POST" })
				.catch((err) => setLoadError(messageOf(err)))
				.finally(() => {
					setSorting((s) => {
						const next = new Set(s);
						next.delete(id);
						return next;
					});
					void load();
				});
		},
		[load],
	);

	const save = async () => {
		setSaving(true);
		setSaveError(null);
		setSavedNote(null);
		try {
			const { entry } = await api<{ entry: Entry }>("/api/entries", {
				body: {
					text: draft.text,
					source: draft.interviewQuestionId ? "interview" : draft.dictated ? "dictation" : "typed",
					prompt: draft.prompt || undefined,
					interviewQuestionId: draft.interviewQuestionId,
					extract: false,
				},
			});
			setDraft(EMPTY_DRAFT);
			setSavedNote("Saved. Sorting it into your experience bank in the background. You can keep going.");
			setEntries((list) => [entry, ...(list ?? [])]);
			sort(entry.id);
		} catch (err) {
			setSaveError(messageOf(err));
		} finally {
			setSaving(false);
		}
	};

	const choosePrompt = (prompt: string, interviewQuestionId: string | null = null) => {
		setDraft((d) => ({ ...d, prompt, interviewQuestionId }));
		boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		boxRef.current?.querySelector("textarea")?.focus();
	};

	return (
		<>
			<PageHeader
				title="Capture"
				description="Talk through anything: a story, a job, a setback, a person, a goal. Notes are saved on this computer and sorted into your experience bank, which every essay draws from."
			/>

			<div ref={boxRef} className="mb-8 scroll-mt-6 panel p-4">
				{draft.prompt && (
					<div className="mb-3 flex items-start justify-between gap-3 rounded-md bg-accent-wash px-3 py-2 text-sm text-accent">
						<p>
							<span className="font-medium">Answering: </span>
							{draft.prompt}
						</p>
						<button type="button" className="shrink-0 text-xs underline" onClick={() => setDraft((d) => ({ ...d, prompt: "", interviewQuestionId: null }))}>
							Clear
						</button>
					</div>
				)}
				<DictationField
					value={draft.text}
					onChange={(text) => setDraft((d) => ({ ...d, text }))}
					onDictated={() => setDraft((d) => (d.dictated ? d : { ...d, dictated: true }))}
					rows={9}
					placeholder="Press Dictate and tell it the way you'd tell a friend: what happened, what you did, how it felt, what changed. Rambling is fine."
					aria-label="Your note"
					footer={
						<>
							{draft.text && (
								<Button variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)} disabled={saving}>
									Discard
								</Button>
							)}
							<Button variant="primary" onClick={save} busy={saving} disabled={!draft.text.trim()}>
								Save note
							</Button>
						</>
					}
				/>
				{saveError && <Notice className="mt-3">{saveError}</Notice>}
				{savedNote && <Notice tone="ok" className="mt-3">{savedNote}</Notice>}
			</div>

			{loadError && <Notice className="mb-6">{loadError}</Notice>}

			<div className="grid gap-x-8 lg:grid-cols-2">
				<InterviewSection interview={interview} onAnswer={choosePrompt} onChange={setInterview} />
				<Section title="Starting points" description="Pick one to answer, or just talk.">
					<ul className="divide-y divide-rule panel">
						{STARTERS.map((s) => (
							<li key={s} className="flex items-center gap-3 px-3 py-2">
								<p className="min-w-0 flex-1 text-sm">{s}</p>
								<Button size="sm" variant="ghost" onClick={() => choosePrompt(s)} aria-label={`Answer: ${s}`}>
									Answer
								</Button>
							</li>
						))}
					</ul>
				</Section>
			</div>

			<ImportSection onImported={load} />

			<Section title="Notes" description="Everything you've captured. Edit or re-sort a note, or delete it.">
				{entries === null ? (
					<p className="text-sm text-muted">Loading…</p>
				) : entries.length === 0 ? (
					<EmptyState>No notes yet. Dictate your first story above.</EmptyState>
				) : (
					<ul className="divide-y divide-rule panel">
						{entries.map((entry) => (
							<EntryRow key={entry.id} entry={entry} titles={titles} queued={sorting.has(entry.id)} onSort={() => sort(entry.id)} onChanged={load} />
						))}
					</ul>
				)}
			</Section>
		</>
	);
}

function InterviewSection({
	interview,
	onAnswer,
	onChange,
}: {
	interview: Interview | null;
	onAnswer: (prompt: string, interviewQuestionId: string) => void;
	onChange: (interview: Interview) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = interview?.questions.filter((q) => q.status === "open") ?? [];

	const ask = async () => {
		setBusy(true);
		setError(null);
		try {
			onChange((await api<{ interview: Interview }>("/api/interview", { body: { count: 5 } })).interview);
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	};

	const skip = async (id: string) => {
		try {
			onChange((await api<{ interview: Interview }>(`/api/interview/${id}`, { method: "PATCH", body: { status: "skipped" } })).interview);
		} catch (err) {
			setError(messageOf(err));
		}
	};

	return (
		<Section
			title="Interview me"
			description="The agent reads your bank and asks about what's missing."
			actions={
				<Button size="sm" onClick={ask} busy={busy}>
					{open.length ? "Ask more" : "Ask me questions"}
				</Button>
			}
		>
			{error && <Notice className="mb-3">{error}</Notice>}
			{open.length === 0 ? (
				<EmptyState>{busy ? "Reading your bank…" : "No open questions. Ask for some when you're ready."}</EmptyState>
			) : (
				<ul className="divide-y divide-rule panel">
					{open.map((q) => (
						<li key={q.id} className="px-3 py-2.5">
							<div className="mb-1 flex items-center gap-2">{q.theme && <Badge tone="accent">{q.theme}</Badge>}</div>
							<p className="text-sm">{q.question}</p>
							{q.why && <p className="mt-0.5 text-xs text-muted">{q.why}</p>}
							<div className="mt-2 flex gap-2">
								<Button size="sm" variant="primary" onClick={() => onAnswer(q.question, q.id)}>
									Answer
								</Button>
								<Button size="sm" variant="ghost" onClick={() => skip(q.id)}>
									Skip
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
		</Section>
	);
}

const ACCEPT = ".docx,.pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function ImportSection({ onImported }: { onImported: () => Promise<void> }) {
	const [files, setFiles] = useState<File[]>([]);
	const [sample, setSample] = useState(true);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const upload = async () => {
		if (!files.length) return;
		setBusy(true);
		setError(null);
		setDone(null);
		try {
			const form = new FormData();
			for (const file of files) form.append("file", file);
			form.set("writingSample", String(sample));
			const res = await fetch("/api/import", { method: "POST", body: form });
			const data = (await res.json().catch(() => ({}))) as { imported?: Entry[]; failed?: { name: string; error: string }[]; error?: string };
			if (data.error) throw new Error(data.error);
			const imported = data.imported ?? [];
			const failed = data.failed ?? [];
			if (imported.length) {
				setDone(
					`Uploaded ${imported.length} file${imported.length === 1 ? "" : "s"}. Each is being added to your experience bank and reviewed in the background; the review appears on the document below.`,
				);
			}
			if (failed.length) setError(failed.map((f) => f.error).join(" "));
			setFiles([]);
			if (inputRef.current) inputRef.current.value = "";
			await onImported();
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Section
			title="Upload essays and stories"
			description="Past essays, personal statements, stories, a résumé (.docx, .pdf, .txt or .md, up to 20 at once). Each one is added to your experience bank and the graph, and the coach reviews it."
		>
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					setFiles((current) => [...current, ...Array.from(e.dataTransfer.files)]);
				}}
				className={cx("rounded-md border border-dashed px-4 py-4", dragging ? "border-accent bg-accent-wash" : "border-rule-2 bg-paper")}
			>
				<div className="flex flex-wrap items-center gap-3">
					<Button onClick={() => inputRef.current?.click()}>Choose files</Button>
					<span className="text-sm text-muted">or drop them here</span>
					<input
						ref={inputRef}
						type="file"
						multiple
						accept={ACCEPT}
						className="hidden"
						onChange={(e) => setFiles((current) => [...current, ...Array.from(e.target.files ?? [])])}
					/>
				</div>
				{files.length > 0 && (
					<ul className="mt-3 grid gap-1 text-sm">
						{files.map((f, i) => (
							<li key={`${f.name}-${i}`} className="flex items-center gap-2">
								<span className="truncate">{f.name}</span>
								<span className="text-xs text-muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
								<button type="button" className="text-xs text-muted underline" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
									remove
								</button>
							</li>
						))}
					</ul>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-3">
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
						My own writing: use it to match my voice
					</label>
					<Button variant="primary" onClick={upload} busy={busy} disabled={!files.length} className="ml-auto">
						Upload {files.length > 1 ? `${files.length} files` : ""}
					</Button>
				</div>
			</div>
			{error && <Notice className="mt-3">{error}</Notice>}
			{done && <Notice tone="ok" className="mt-3">{done}</Notice>}
		</Section>
	);
}

const SOURCE_LABEL: Record<Entry["source"], string> = { dictation: "Dictated", typed: "Typed", interview: "Answer", import: "Imported", chat: "From essay chat" };

function EntryRow({
	entry,
	titles,
	queued,
	onSort,
	onChanged,
}: {
	entry: Entry;
	titles: Record<string, string>;
	queued: boolean;
	onSort: () => void;
	onChanged: () => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState(entry.text);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setText(entry.text), [entry.text]);

	const status = entry.extraction.status;
	const working = queued || status === "running";
	const edited = text.trim() !== entry.text;

	const saveEdit = async () => {
		setBusy(true);
		setError(null);
		try {
			await api(`/api/entries/${entry.id}`, { method: "PATCH", body: { text } });
			await onChanged();
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!window.confirm("Delete this note? Experiences already built from it stay in your bank.")) return;
		setBusy(true);
		try {
			await api(`/api/entries/${entry.id}`, { method: "DELETE" });
			await onChanged();
		} catch (err) {
			setError(messageOf(err));
			setBusy(false);
		}
	};

	const retryReview = async () => {
		setError(null);
		try {
			await api(`/api/entries/${entry.id}/review`, { method: "POST" });
			await onChanged();
		} catch (err) {
			setError(messageOf(err));
		}
	};

	const toggleSample = async () => {
		try {
			await api(`/api/entries/${entry.id}`, { method: "PATCH", body: { writingSample: !entry.writingSample } });
			await onChanged();
		} catch (err) {
			setError(messageOf(err));
		}
	};

	return (
		<li className="px-3 py-2.5">
			<button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
				<ChevronIcon open={open} className="mt-0.5 shrink-0 text-muted" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2 text-xs text-muted">
						<span>{formatDateTime(entry.createdAt)}</span>
						<Badge>{SOURCE_LABEL[entry.source]}</Badge>
						{entry.writingSample && <Badge tone="accent">Voice sample</Badge>}
						{entry.review?.status === "done" && <Badge tone="accent">Reviewed</Badge>}
						{(entry.review?.status === "pending" || entry.review?.status === "running") && <Badge tone="warn">Reviewing…</Badge>}
						{entry.title && <span className="truncate">{entry.title}</span>}
						<span className="ml-auto">
							{working ? (
								<Badge tone="warn">{status === "running" ? "Sorting…" : "Waiting to sort"}</Badge>
							) : status === "done" ? (
								<Badge tone="ok">
									{entry.extraction.experienceIds.length} experience{entry.extraction.experienceIds.length === 1 ? "" : "s"}
								</Badge>
							) : status === "failed" ? (
								<Badge tone="danger">Sorting failed</Badge>
							) : (
								<Badge>Not sorted</Badge>
							)}
						</span>
					</div>
					{entry.prompt && <p className="mt-1 text-xs text-muted">Q: {entry.prompt}</p>}
					<p className={cx("mt-1 text-sm", !open && "line-clamp-2")}>{open ? null : entry.text}</p>
				</div>
			</button>
			{open && (
				<div className="mt-2 pl-6">
					<TextArea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(16, Math.max(4, Math.ceil(text.length / 90)))} />
					{status === "failed" && entry.extraction.error && <Notice className="mt-2">{entry.extraction.error}</Notice>}
					{status === "done" && entry.extraction.experienceIds.length > 0 && (
						<p className="mt-2 text-xs text-muted">
							Sorted into:{" "}
							{entry.extraction.experienceIds.map((id, i) => (
								<span key={id}>
									{i > 0 && ", "}
									<Link href={`/bank#${id}`} className="underline">
										{titles[id] ?? "(deleted experience)"}
									</Link>
								</span>
							))}
						</p>
					)}
					{entry.review && <ReviewView entry={entry} onRetry={retryReview} />}
					{error && <Notice className="mt-2">{error}</Notice>}
					<div className="mt-2 flex flex-wrap gap-2">
						{edited && (
							<Button size="sm" variant="primary" onClick={saveEdit} busy={busy}>
								Save changes
							</Button>
						)}
						<Button size="sm" onClick={onSort} disabled={working || edited}>
							{status === "done" ? "Sort again" : "Sort now"}
						</Button>
						<Button size="sm" variant="ghost" onClick={toggleSample}>
							{entry.writingSample ? "Not a voice sample" : "Use as voice sample"}
						</Button>
						<Button size="sm" variant="danger" onClick={remove} disabled={working || busy} className="ml-auto">
							Delete
						</Button>
					</div>
				</div>
			)}
		</li>
	);
}

function ReviewView({ entry, onRetry }: { entry: Entry; onRetry: () => void }) {
	const review = entry.review!;
	if (review.status === "pending" || review.status === "running") return <p className="mt-2 text-xs text-muted">The coach is reviewing this document…</p>;
	if (review.status === "failed") {
		return (
			<Notice className="mt-2">
				Review failed: {review.error}{" "}
				<button type="button" className="underline" onClick={onRetry}>
					Try again
				</button>
			</Notice>
		);
	}
	const list = (title: string, items: string[]) =>
		items.length > 0 && (
			<div>
				<p className="text-xs font-medium text-muted">{title}</p>
				<ul className="mt-1 list-disc space-y-1 pl-5">
					{items.map((item, i) => (
						<li key={i}>{item}</li>
					))}
				</ul>
			</div>
		);
	return (
		<div className="mt-4 grid gap-3 border-l-2 border-accent pl-4 text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="font-semibold">Review</h3>
				<Badge>{review.kind}</Badge>
				<button type="button" className="ml-auto text-xs text-muted underline" onClick={onRetry}>
					Review again
				</button>
			</div>
			<p>{review.summary}</p>
			<div className="grid gap-3 sm:grid-cols-2">
				{list("What works", review.strengths)}
				{list("What's weak", review.weaknesses)}
			</div>
			{list("How to strengthen it", review.suggestions)}
			{review.goodFor.length > 0 && (
				<p className="text-xs text-muted">
					Could answer prompts about: <span className="text-ink">{review.goodFor.join("; ")}</span>
				</p>
			)}
		</div>
	);
}
