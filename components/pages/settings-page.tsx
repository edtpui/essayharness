"use client";

import { useEffect, useState } from "react";
import { api, messageOf } from "@/lib/api";
import { PROVIDERS, PROVIDER_LABELS, type CredentialName, type ModelRef, type Provider, type Settings, type SettingsView, type UsageSummary } from "@/lib/types";
import { DICTATION_LANGUAGES, formatDateTime, formatUsd } from "@/lib/text";
import { useApp } from "../app-context";
import { Badge, Button, Field, Notice, PageHeader, Section, Select, TextInput } from "../ui";

const SUGGESTED: Record<Provider, string[]> = {
	anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
	openai: [],
	custom: [],
};

export function SettingsPage() {
	const { view, refresh, setView, loadError } = useApp();
	if (!view) return loadError ? <Notice>{loadError}</Notice> : <p className="text-sm text-muted">Loading…</p>;
	return (
		<>
			<PageHeader title="Settings" description="Models, API keys, and what this has cost so far. Keys stay on this computer; the browser only ever sees their last four characters." />
			<ModelSettings key={JSON.stringify(view.settings)} view={view} onSaved={setView} />
			<KeySettings view={view} onChanged={refresh} />
			<UsageSection />
			<Section title="Your data" description="Everything is plain JSON in one folder. Back it up like any important document.">
				<div className="rounded-md border border-border bg-surface px-3 py-3 text-sm">
					<p className="font-mono text-[13px] break-all">{view.dataDir}</p>
					<p className="mt-2 text-muted">
						<code>entries/</code> your notes and answers · <code>experiences/</code> the bank · <code>essays/</code> briefs, plans and every draft ·{" "}
						<code>profile.json</code> · <code>settings.json</code> · <code>credentials.json</code> (API keys) · <code>usage.jsonl</code>. Set <code>SE_DATA_DIR</code> to move it.
					</p>
					<p className="mt-2 text-muted">
						Stored locally, but not processed offline: notes and drafts are sent to the model provider you choose, and dictation audio goes to Deepgram.
					</p>
				</div>
			</Section>
		</>
	);
}

function ModelPicker({ label, value, onChange, customName }: { label: string; value: ModelRef; onChange: (ref: ModelRef) => void; customName: string }) {
	const [models, setModels] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const listId = `models-${label.replace(/\W+/g, "-")}`;

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			setModels((await api<{ models: string[] }>(`/api/models?provider=${value.provider}`)).models);
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setLoading(false);
		}
	};

	const options = [...new Set([...SUGGESTED[value.provider], ...models])];
	return (
		<div className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
			<Field label={label}>
				<Select
					value={value.provider}
					onChange={(e) => {
						const provider = e.target.value as Provider;
						setModels([]);
						onChange({ provider, model: SUGGESTED[provider][0] ?? "" });
					}}
				>
					{PROVIDERS.map((p) => (
						<option key={p} value={p}>
							{p === "custom" ? customName || PROVIDER_LABELS.custom : PROVIDER_LABELS[p]}
						</option>
					))}
				</Select>
			</Field>
			<Field label="Model">
				<TextInput list={listId} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} placeholder="Model id" />
				<datalist id={listId}>
					{options.map((m) => (
						<option key={m} value={m} />
					))}
				</datalist>
			</Field>
			<Button onClick={load} busy={loading}>
				List models
			</Button>
			{error && <p className="text-xs text-danger sm:col-span-3">{error}</p>}
			{models.length > 0 && <p className="text-xs text-muted sm:col-span-3">{models.length} models available — pick one from the model field&apos;s suggestions.</p>}
		</div>
	);
}

function ModelSettings({ view, onSaved }: { view: SettingsView; onSaved: (view: SettingsView) => void }) {
	const [form, setForm] = useState<Settings>(view.settings);
	const [separate, setSeparate] = useState(view.settings.extractionModel !== null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
		setSaved(false);
		setForm((f) => ({ ...f, [key]: value }));
	};

	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			const next = await api<SettingsView>("/api/settings", {
				method: "PUT",
				body: { ...form, extractionModel: separate ? (form.extractionModel ?? form.mainModel) : null },
			});
			onSaved(next);
			setSaved(true);
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Section title="Models" description="The writing model plans, asks questions, drafts and fact-checks. Claude Opus 5.5 is the default.">
			<div className="grid gap-4 rounded-md border border-border bg-surface p-4">
				<ModelPicker label="Writing model" value={form.mainModel} onChange={(ref) => set("mainModel", ref)} customName={form.customName} />
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" checked={separate} onChange={(e) => (setSaved(false), setSeparate(e.target.checked))} />
					Use a different model for sorting notes into the bank
				</label>
				{separate && (
					<ModelPicker
						label="Sorting model"
						value={form.extractionModel ?? form.mainModel}
						onChange={(ref) => set("extractionModel", ref)}
						customName={form.customName}
					/>
				)}
				<div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
					<Field label="OpenAI-compatible endpoint" hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 · OpenRouter: https://openrouter.ai/api/v1">
						<TextInput value={form.customBaseUrl} onChange={(e) => set("customBaseUrl", e.target.value)} placeholder="http://localhost:11434/v1" />
					</Field>
					<Field label="Endpoint name" hint="How it's labelled in this app">
						<TextInput value={form.customName} onChange={(e) => set("customName", e.target.value)} />
					</Field>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="Dictation language">
						<Select value={form.dictationLanguage} onChange={(e) => set("dictationLanguage", e.target.value)}>
							{DICTATION_LANGUAGES.map((l) => (
								<option key={l.code} value={l.code}>
									{l.label}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Questions per plan" hint="The most gap questions one planning pass may ask">
						<TextInput type="number" min={1} max={12} value={form.maxQuestions} onChange={(e) => set("maxQuestions", Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
					</Field>
				</div>
				{error && <Notice>{error}</Notice>}
				<div className="flex items-center gap-2">
					<Button variant="primary" onClick={save} busy={busy}>
						Save settings
					</Button>
					{saved && <span className="text-xs text-ok">Saved</span>}
				</div>
			</div>
		</Section>
	);
}

const KEY_ROWS: { name: CredentialName; label: string; help: string }[] = [
	{ name: "anthropic", label: "Anthropic", help: "console.anthropic.com → API keys" },
	{ name: "openai", label: "OpenAI", help: "platform.openai.com → API keys" },
	{ name: "custom", label: "Custom endpoint", help: "Only if your endpoint needs one (OpenRouter does; Ollama doesn't)" },
	{ name: "deepgram", label: "Deepgram (dictation)", help: "console.deepgram.com — the key needs Member permission or higher" },
];

function KeySettings({ view, onChanged }: { view: SettingsView; onChanged: () => Promise<void> }) {
	return (
		<Section title="API keys" description="Saved in credentials.json in your data folder. A key set as an environment variable is used when none is saved here.">
			<ul className="divide-y divide-border rounded-md border border-border bg-surface">
				{KEY_ROWS.map((row) => (
					<KeyRow key={row.name} row={row} status={view.credentials[row.name]} onChanged={onChanged} />
				))}
			</ul>
		</Section>
	);
}

function KeyRow({ row, status, onChanged }: { row: (typeof KEY_ROWS)[number]; status: SettingsView["credentials"][CredentialName]; onChanged: () => Promise<void> }) {
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState<null | "save" | "clear" | "test">(null);
	const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

	const call = async (kind: "save" | "clear" | "test") => {
		setBusy(kind);
		setResult(null);
		try {
			if (kind === "test") {
				const res = await api<{ detail: string }>("/api/settings/test", { body: { target: row.name } });
				setResult({ ok: true, text: res.detail });
			} else {
				await api("/api/settings/keys", { method: "PUT", body: { name: row.name, key: kind === "save" ? value : null } });
				setValue("");
				await onChanged();
				setResult({ ok: true, text: kind === "save" ? "Saved." : "Removed." });
			}
		} catch (err) {
			setResult({ ok: false, text: messageOf(err) });
		} finally {
			setBusy(null);
		}
	};

	return (
		<li className="grid gap-2 px-3 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-center">
			<div>
				<p className="text-sm font-medium">{row.label}</p>
				<p className="text-xs">
					{status.source === "saved" ? <Badge tone="ok">Saved {status.hint}</Badge> : status.source === "env" ? <Badge tone="accent">From {status.hint}</Badge> : <Badge>Not set</Badge>}
				</p>
			</div>
			<div>
				<TextInput
					type="password"
					autoComplete="off"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={status.source === "none" ? "Paste key" : "Paste a new key to replace it"}
					aria-label={`${row.label} API key`}
				/>
				<p className="mt-1 text-xs text-muted">{row.help}</p>
			</div>
			<div className="flex gap-2">
				<Button onClick={() => call("save")} busy={busy === "save"} disabled={!value.trim() || busy !== null} variant="primary">
					Save
				</Button>
				<Button onClick={() => call("test")} busy={busy === "test"} disabled={busy !== null || (row.name !== "custom" && status.source === "none")}>
					Test
				</Button>
				{status.source === "saved" && (
					<Button variant="ghost" onClick={() => call("clear")} busy={busy === "clear"} disabled={busy !== null}>
						Remove
					</Button>
				)}
			</div>
			{result && <p className={`text-xs sm:col-span-3 ${result.ok ? "text-ok" : "text-danger"}`}>{result.text}</p>}
		</li>
	);
}

const TASK_LABEL: Record<string, string> = {
	extract: "Sorting notes",
	plan: "Planning",
	interview: "Interview questions",
	draft: "Drafts",
	revise: "Revisions",
	tighten: "Cutting to limit",
	audit: "Fact checks",
	test: "Tests",
};

function UsageSection() {
	const [usage, setUsage] = useState<UsageSummary | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		api<{ usage: UsageSummary }>("/api/usage")
			.then((r) => setUsage(r.usage))
			.catch((err) => setError(messageOf(err)));
	}, []);

	return (
		<Section title="Usage" description="Estimated from Anthropic list prices. Calls to other providers are counted in tokens only.">
			{error && <Notice>{error}</Notice>}
			{usage && (
				<div className="rounded-md border border-border bg-surface p-4 text-sm">
					<div className="flex flex-wrap gap-x-8 gap-y-2">
						<div>
							<p className="text-xs text-muted">Estimated spend</p>
							<p className="text-lg font-semibold tabular-nums">{formatUsd(usage.totalCostUsd)}</p>
						</div>
						<div>
							<p className="text-xs text-muted">Model calls</p>
							<p className="text-lg font-semibold tabular-nums">{usage.calls}</p>
						</div>
						<div>
							<p className="text-xs text-muted">Tokens in / out</p>
							<p className="text-lg font-semibold tabular-nums">
								{usage.inputTokens.toLocaleString()} / {usage.outputTokens.toLocaleString()}
							</p>
						</div>
					</div>
					{Object.keys(usage.byTask).length > 0 && (
						<table className="mt-4 w-full text-left text-[13px]">
							<thead className="text-xs text-muted">
								<tr>
									<th className="py-1 font-medium">Task</th>
									<th className="py-1 text-right font-medium">Calls</th>
									<th className="py-1 text-right font-medium">Tokens in</th>
									<th className="py-1 text-right font-medium">Tokens out</th>
									<th className="py-1 text-right font-medium">Cost</th>
								</tr>
							</thead>
							<tbody className="tabular-nums">
								{Object.entries(usage.byTask).map(([task, t]) => (
									<tr key={task} className="border-t border-border">
										<td className="py-1.5">{TASK_LABEL[task] ?? task}</td>
										<td className="py-1.5 text-right">{t.calls}</td>
										<td className="py-1.5 text-right">{t.inputTokens.toLocaleString()}</td>
										<td className="py-1.5 text-right">{t.outputTokens.toLocaleString()}</td>
										<td className="py-1.5 text-right">{formatUsd(t.costUsd)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					{usage.recent.length > 0 && (
						<details className="mt-3">
							<summary className="cursor-pointer text-xs text-muted">Recent calls</summary>
							<ul className="mt-2 grid gap-1 text-xs text-muted tabular-nums">
								{usage.recent.map((r, i) => (
									<li key={`${r.at}-${i}`}>
										{formatDateTime(r.at)} · {TASK_LABEL[r.task] ?? r.task} · {r.model} · {r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens} in / {r.outputTokens} out
										{r.costUsd !== null && ` · ${formatUsd(r.costUsd)}`}
									</li>
								))}
							</ul>
						</details>
					)}
				</div>
			)}
		</Section>
	);
}
