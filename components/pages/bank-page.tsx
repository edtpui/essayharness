"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, messageOf } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABELS, type BankImportResult, type Category, type Entry, type Experience, type ExperienceInput, type Profile } from "@/lib/types";
import { formatDate, formatDateTime, normalizeForMatch } from "@/lib/text";
import { DictationField } from "../dictation";
import { ChevronIcon } from "../icons";
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Section, Select, TextArea, TextInput, cx } from "../ui";

export function BankPage() {
	const [list, setList] = useState<Experience[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<Category | "all">("all");
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState(false);
	const [importNote, setImportNote] = useState<string | null>(null);
	const [bankVersion, setBankVersion] = useState(0);
	const fileRef = useRef<HTMLInputElement>(null);

	const load = useCallback(async () => {
		try {
			setList((await api<{ experiences: Experience[] }>("/api/experiences")).experiences);
			setError(null);
		} catch (err) {
			setError(messageOf(err));
		}
	}, []);

	const onImportFile = async (file: File) => {
		setImporting(true);
		setImportNote(null);
		setError(null);
		try {
			let bundle: unknown;
			try {
				bundle = JSON.parse(await file.text());
			} catch {
				throw new Error("That file is not a bank export: it is not valid JSON.");
			}
			const { result } = await api<{ result: BankImportResult }>("/api/bank/import", { body: bundle });
			const added = result.experiencesAdded + result.entriesAdded;
			const skipped = result.experiencesSkipped + result.entriesSkipped;
			setImportNote(
				added === 0 && !result.profileImported
					? "Nothing new in that file: everything in it is already in your bank."
					: `Imported ${result.experiencesAdded} experience${result.experiencesAdded === 1 ? "" : "s"} and ${result.entriesAdded} note${result.entriesAdded === 1 ? "" : "s"}` +
						(result.profileImported ? ", plus your profile" : "") +
						(skipped ? `. ${skipped} item${skipped === 1 ? "" : "s"} already here, skipped` : "") +
						".",
			);
			setBankVersion((v) => v + 1);
			await load();
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setImporting(false);
		}
	};

	useEffect(() => {
		void load();
		const hash = window.location.hash.slice(1);
		if (hash.startsWith("exp_")) setOpenId(hash);
	}, [load]);

	useEffect(() => {
		if (openId && list) document.getElementById(openId)?.scrollIntoView({ block: "start" });
	}, [openId, list]);

	const counts = useMemo(() => {
		const c: Partial<Record<Category, number>> = {};
		for (const e of list ?? []) c[e.category] = (c[e.category] ?? 0) + 1;
		return c;
	}, [list]);

	const visible = useMemo(() => {
		const q = normalizeForMatch(query);
		return (list ?? []).filter((e) => {
			if (category !== "all" && e.category !== category) return false;
			if (!q) return true;
			const hay = normalizeForMatch([e.title, e.summary, e.details, e.actions, e.outcomes, e.reflections, e.role, e.timeframe, ...e.skills, ...e.people, ...e.quotes].join(" "));
			return q.split(" ").every((w) => hay.includes(w));
		});
	}, [list, query, category]);

	return (
		<>
			<PageHeader
				title="Experience bank"
				description="Everything the essay agent knows about you, sorted from your notes. Edit anything that's wrong: essays only use what's here and in your answers."
				actions={
					<div className="flex flex-wrap gap-2">
						<input
							ref={fileRef}
							type="file"
							accept="application/json,.json"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								e.target.value = "";
								if (file) void onImportFile(file);
							}}
						/>
						<Button onClick={() => fileRef.current?.click()} busy={importing}>
							Import bank
						</Button>
						<Button
							onClick={() => {
								window.location.href = "/api/bank/export";
							}}
						>
							Export bank
						</Button>
						<Button variant="primary" onClick={() => setCreating(true)} disabled={creating}>
							Add experience
						</Button>
					</div>
				}
			/>
			<ProfileSection key={bankVersion} />

			{error && <Notice className="mb-4">{error}</Notice>}
			{importNote && <p className="mb-4 text-sm text-success">{importNote}</p>}

			{creating && (
				<div className="mb-6 panel p-4">
					<h2 className="mb-3 text-md font-semibold">New experience</h2>
					<ExperienceEditor
						onSaved={async () => {
							setCreating(false);
							await load();
						}}
						onCancel={() => setCreating(false)}
					/>
				</div>
			)}

			<Section title={`Experiences${list ? ` (${list.length})` : ""}`}>
				<div className="mb-3 flex flex-wrap gap-1.5">
					<CategoryChip active={category === "all"} onClick={() => setCategory("all")} label="All" count={list?.length ?? 0} />
					{CATEGORIES.map((c) => (
						<CategoryChip key={c} active={category === c} onClick={() => setCategory(c)} label={CATEGORY_LABELS[c]} count={counts[c] ?? 0} />
					))}
				</div>
				<TextInput placeholder="Search titles, details, skills, people…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-3 max-w-md" />
				{list === null ? (
					<p className="text-sm text-muted">Loading…</p>
				) : list.length === 0 ? (
					<EmptyState>
						Your bank is empty. <Link href="/" className="underline">Capture</Link> a few stories and they&apos;ll appear here.
					</EmptyState>
				) : visible.length === 0 ? (
					<EmptyState>Nothing matches.</EmptyState>
				) : (
					<ul className="divide-y divide-rule panel">
						{visible.map((exp) => (
							<ExperienceRow key={exp.id} experience={exp} open={openId === exp.id} onToggle={() => setOpenId((id) => (id === exp.id ? null : exp.id))} onChanged={load} />
						))}
					</ul>
				)}
			</Section>
		</>
	);
}

function CategoryChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cx(
				"inline-flex min-h-8 items-center rounded-(--radius-input) border px-2.5 text-sm",
				active ? "border-accent bg-accent-wash text-accent" : "border-rule bg-paper text-muted hover:text-ink",
				count === 0 && !active && "opacity-60",
			)}
		>
			{label} <span className="tabular-nums">{count}</span>
		</button>
	);
}

function ExperienceRow({ experience, open, onToggle, onChanged }: { experience: Experience; open: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
	return (
		<li id={experience.id} className="scroll-mt-6">
			<button type="button" onClick={onToggle} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-paper-2" aria-expanded={open}>
				<ChevronIcon open={open} className="mt-0.5 shrink-0 text-muted" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-medium">{experience.title}</span>
						<Badge>{CATEGORY_LABELS[experience.category]}</Badge>
						{experience.timeframe && <span className="text-xs text-muted">{experience.timeframe}</span>}
					</div>
					{experience.summary && <p className={cx("mt-0.5 text-sm text-muted", !open && "line-clamp-2")}>{experience.summary}</p>}
				</div>
				<span className="shrink-0 text-xs text-muted">{formatDate(experience.updatedAt)}</span>
			</button>
			{open && (
				<div className="border-t border-rule px-3 py-3 pl-9">
					<ExperienceEditor experience={experience} onSaved={onChanged} />
					<Sources experienceId={experience.id} count={experience.sourceEntryIds.length} />
				</div>
			)}
		</li>
	);
}

const toInput = (e?: Experience): ExperienceInput => ({
	title: e?.title ?? "",
	category: e?.category ?? "other",
	timeframe: e?.timeframe ?? "",
	summary: e?.summary ?? "",
	role: e?.role ?? "",
	details: e?.details ?? "",
	actions: e?.actions ?? "",
	outcomes: e?.outcomes ?? "",
	reflections: e?.reflections ?? "",
	skills: e?.skills ?? [],
	people: e?.people ?? [],
	quotes: e?.quotes ?? [],
});

function lines(text: string): string[] {
	return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function ExperienceEditor({ experience, onSaved, onCancel }: { experience?: Experience; onSaved: () => Promise<void>; onCancel?: () => void }) {
	const [form, setForm] = useState<ExperienceInput>(() => toInput(experience));
	const [skills, setSkills] = useState(() => (experience?.skills ?? []).join(", "));
	const [people, setPeople] = useState(() => (experience?.people ?? []).join("\n"));
	const [quotes, setQuotes] = useState(() => (experience?.quotes ?? []).join("\n"));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const set = <K extends keyof ExperienceInput>(key: K, value: ExperienceInput[K]) => {
		setSaved(false);
		setForm((f) => ({ ...f, [key]: value }));
	};

	const save = async () => {
		setBusy(true);
		setError(null);
		const body: ExperienceInput = {
			...form,
			skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
			people: lines(people),
			quotes: lines(quotes),
		};
		try {
			if (experience) await api(`/api/experiences/${experience.id}`, { method: "PUT", body });
			else await api("/api/experiences", { body });
			setSaved(true);
			await onSaved();
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!experience || !window.confirm(`Delete "${experience.title}" from your bank? Its notes stay in Capture.`)) return;
		setBusy(true);
		try {
			await api(`/api/experiences/${experience.id}`, { method: "DELETE" });
			await onSaved();
		} catch (err) {
			setError(messageOf(err));
			setBusy(false);
		}
	};

	const area = (key: "summary" | "details" | "actions" | "outcomes" | "reflections", label: string, rows: number, hint?: string) => (
		<Field label={label} hint={hint} htmlFor={`${experience?.id ?? "new"}-${key}`}>
			<TextArea id={`${experience?.id ?? "new"}-${key}`} rows={rows} value={form[key]} onChange={(e) => set(key, e.target.value)} />
		</Field>
	);

	return (
		<div className="grid gap-3">
			<div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
				<Field label="Title" htmlFor={`${experience?.id ?? "new"}-title`}>
					<TextInput id={`${experience?.id ?? "new"}-title`} value={form.title} onChange={(e) => set("title", e.target.value)} />
				</Field>
				<Field label="Category">
					<Select value={form.category} onChange={(e) => set("category", e.target.value as Category)}>
						{CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{CATEGORY_LABELS[c]}
							</option>
						))}
					</Select>
				</Field>
				<Field label="When">
					<TextInput value={form.timeframe} onChange={(e) => set("timeframe", e.target.value)} placeholder="e.g. Grade 11" />
				</Field>
			</div>
			<Field label="Role">
				<TextInput value={form.role} onChange={(e) => set("role", e.target.value)} />
			</Field>
			{area("summary", "Summary", 2)}
			{area("details", "What happened", 4)}
			<div className="grid gap-3 sm:grid-cols-2">
				{area("actions", "What I did", 3)}
				{area("outcomes", "Outcomes", 3, "Results, impact, numbers")}
			</div>
			{area("reflections", "Reflections", 3, "Why it mattered, what you learned or changed")}
			<div className="grid gap-3 sm:grid-cols-3">
				<Field label="Shows" hint="Comma-separated">
					<TextInput value={skills} onChange={(e) => (setSaved(false), setSkills(e.target.value))} />
				</Field>
				<Field label="People" hint="One per line">
					<TextArea rows={3} value={people} onChange={(e) => (setSaved(false), setPeople(e.target.value))} />
				</Field>
				<Field label="In your words" hint="One quote per line">
					<TextArea rows={3} value={quotes} onChange={(e) => (setSaved(false), setQuotes(e.target.value))} />
				</Field>
			</div>
			{error && <Notice>{error}</Notice>}
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="primary" onClick={save} busy={busy}>
					{experience ? "Save changes" : "Add to bank"}
				</Button>
				{onCancel && (
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				)}
				{saved && <span className="text-xs text-success">Saved</span>}
				{experience && (
					<Button variant="danger" onClick={remove} disabled={busy} className="ml-auto">
						Delete
					</Button>
				)}
			</div>
		</div>
	);
}

function Sources({ experienceId, count }: { experienceId: string; count: number }) {
	const [open, setOpen] = useState(false);
	const [sources, setSources] = useState<Entry[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || sources) return;
		api<{ sources: Entry[] }>(`/api/experiences/${experienceId}`)
			.then((r) => setSources(r.sources))
			.catch((err) => setError(messageOf(err)));
	}, [open, sources, experienceId]);

	if (count === 0) return <p className="mt-3 text-xs text-muted">Added by hand.</p>;
	return (
		<div className="mt-4 border-t border-rule pt-3">
			<button type="button" className="text-button" onClick={() => setOpen((o) => !o)}>
				<ChevronIcon open={open} width={12} height={12} />
				Built from {count} note{count === 1 ? "" : "s"}
			</button>
			{error && <p className="mt-2 text-xs text-error">{error}</p>}
			{open && sources && (
				<ul className="mt-2 grid gap-2">
					{sources.map((s) => (
						<li key={s.id} className="rounded-md bg-paper-2 px-3 py-2 text-sm">
							<p className="mb-1 text-xs text-muted">
								{formatDateTime(s.createdAt)}
								{s.prompt && `. Q: ${s.prompt}`}
							</p>
							<p className="whitespace-pre-wrap">{s.text}</p>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ProfileSection() {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		api<{ profile: Profile }>("/api/profile")
			.then((r) => {
				setProfile(r.profile);
				setOpen(false);
			})
			.catch((err) => setError(messageOf(err)));
	}, []);

	if (!profile) return error ? <Notice className="mb-6">{error}</Notice> : null;

	const set = (key: keyof Omit<Profile, "updatedAt">, value: string) => {
		setSaved(false);
		setProfile((p) => (p ? { ...p, [key]: value } : p));
	};

	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			const { updatedAt: _ignored, ...body } = profile;
			setProfile((await api<{ profile: Profile }>("/api/profile", { method: "PUT", body })).profile);
			setSaved(true);
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	};

	const filled = [profile.name, profile.education, profile.field, profile.goals].filter((v) => v.trim()).length;

	return (
		<div className="mb-8 panel">
			<button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open}>
				<ChevronIcon open={open} className="text-muted" />
				<span className="text-md font-semibold">About you</span>
				<span className="text-xs text-muted">
					{filled ? `${[profile.name, profile.education, profile.field].filter(Boolean).join(", ")}` : "Basic facts every essay can use"}
				</span>
			</button>
			{open && (
				<div className="grid gap-3 border-t border-rule px-4 py-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Name">
							<TextInput value={profile.name} onChange={(e) => set("name", e.target.value)} />
						</Field>
						<Field label="Where you live">
							<TextInput value={profile.location} onChange={(e) => set("location", e.target.value)} />
						</Field>
						<Field label="Education" hint="School, program, year">
							<TextInput value={profile.education} onChange={(e) => set("education", e.target.value)} />
						</Field>
						<Field label="Intended field of study">
							<TextInput value={profile.field} onChange={(e) => set("field", e.target.value)} />
						</Field>
					</div>
					<Field label="Goals" hint="Career and life goals, in your own words">
						<DictationField value={profile.goals} onChange={(v) => set("goals", v)} rows={2} micSize="sm" />
					</Field>
					<Field label="Other facts" hint="Anything an essay may need: first-generation student, languages, citizenship, family situation…">
						<DictationField value={profile.other} onChange={(v) => set("other", v)} rows={3} micSize="sm" />
					</Field>
					{error && <Notice>{error}</Notice>}
					<div className="flex items-center gap-2">
						<Button variant="primary" onClick={save} busy={busy}>
							Save
						</Button>
						{saved && <span className="text-xs text-success">Saved</span>}
					</div>
				</div>
			)}
		</div>
	);
}
