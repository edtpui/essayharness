"use client";

import { useEffect, useState } from "react";
import { api, messageOf } from "@/lib/api";
import { PROVIDER_LIST, providerInfo, providerLabel } from "@/lib/providers";
import type { CredentialName, CredentialStatus, ModelRef, Provider, Settings, SettingsView, UsageSummary } from "@/lib/types";
import { DICTATION_LANGUAGES, formatDateTime, formatUsd } from "@/lib/text";
import { useApp } from "../app-context";
import { Badge, Button, Field, Notice, PageHeader, Section, Select, TextInput } from "../ui";

const suggested = (provider: Provider): string[] => providerInfo(provider)?.models ?? [];

const FEATURED = ["anthropic", "openai", "google", "openrouter", "custom"];

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
				<div className="panel px-3 py-3 text-sm">
					<p className="mono text-sm break-all text-ink">{view.dataDir}</p>
					<dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-ink-2">
						{[
							["entries/", "your notes and answers"],
							["experiences/", "the bank"],
							["essays/", "briefs, plans, chats and every draft"],
							["profile.json", "about you"],
							["settings.json", "models and options"],
							["credentials.json", "API keys"],
							["usage.jsonl", "one line per model call"],
						].map(([name, what]) => (
							<div key={name} className="contents">
								<dt className="mono text-sm text-ink">{name}</dt>
								<dd className="m-0">{what}</dd>
							</div>
						))}
					</dl>
					<p className="mt-3 text-muted">
						Set <code className="mono">SE_DATA_DIR</code> to move it.
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

	const options = [...new Set([...suggested(value.provider), ...models])];
	return (
		<div className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
			<Field label={label}>
				<Select
					value={value.provider}
					onChange={(e) => {
						const provider = e.target.value;
						setModels([]);
						onChange({ provider, model: suggested(provider)[0] ?? "" });
					}}
				>
					<optgroup label="Common">
						{FEATURED.map((id) => (
							<option key={id} value={id}>
								{providerLabel(id, customName)}
							</option>
						))}
					</optgroup>
					<optgroup label="More providers">
						{PROVIDER_LIST.filter((p) => !FEATURED.includes(p.id)).map((p) => (
							<option key={p.id} value={p.id}>
								{p.label}
							</option>
						))}
					</optgroup>
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
			{error && <p className="text-xs text-error sm:col-span-3">{error}</p>}
			{models.length > 0 && <p className="text-xs text-muted sm:col-span-3">{models.length} models available. Pick one from the model field&apos;s suggestions.</p>}
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
			<div className="grid gap-4 panel p-4">
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
				<div className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2">
					<Field label="OpenAI-compatible endpoint" hint="For example Ollama at http://localhost:11434/v1, LM Studio at http://localhost:1234/v1, OpenRouter at https://openrouter.ai/api/v1">
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
					<Field label="Most questions per plan" hint="Leave blank to let the model decide how many it needs.">
						<TextInput
							inputMode="numeric"
							value={form.maxQuestions ?? ""}
							placeholder="Model decides"
							onChange={(e) => {
								const digits = e.target.value.replace(/[^\d]/g, "");
								set("maxQuestions", digits ? Math.max(1, Math.min(12, Number(digits))) : null);
							}}
						/>
					</Field>
				</div>
				{error && <Notice>{error}</Notice>}
				<div className="flex items-center gap-2">
					<Button variant="primary" onClick={save} busy={busy}>
						Save settings
					</Button>
					{saved && <span className="text-xs text-success">Saved</span>}
				</div>
			</div>
		</Section>
	);
}

interface KeyRowInfo {
	name: CredentialName;
	label: string;
	help: string;
	optional?: boolean;
}

function keyRowFor(id: string, customName: string): KeyRowInfo {
	if (id === "deepgram") return { name: id, label: "Deepgram (dictation)", help: "console.deepgram.com. The key needs Member permission or higher." };
	const info = providerInfo(id);
	return { name: id, label: providerLabel(id, customName), help: info ? `${info.keyHelp}. Or set ${info.envVar}.` : "", optional: info?.keyOptional };
}

function KeySettings({ view, onChanged }: { view: SettingsView; onChanged: () => Promise<void> }) {
	const [added, setAdded] = useState<string[]>([]);
	const s = view.settings;
	// The providers in use, the common ones, anything with a key, and whatever was added here.
	const shown = [
		...new Set([
			s.mainModel.provider,
			...(s.extractionModel ? [s.extractionModel.provider] : []),
			"anthropic",
			"openai",
			"deepgram",
			...Object.entries(view.credentials)
				.filter(([, status]) => status.source !== "none")
				.map(([id]) => id),
			...added,
		]),
	];
	const addable = PROVIDER_LIST.filter((p) => !shown.includes(p.id));
	return (
		<Section title="API keys" description="Saved in credentials.json in your data folder. A key set as an environment variable is used when none is saved here.">
			<ul className="divide-y divide-rule panel">
				{shown.map((id) => (
					<KeyRow key={id} row={keyRowFor(id, s.customName)} status={view.credentials[id] ?? { source: "none", hint: "" }} onChanged={onChanged} />
				))}
			</ul>
			{addable.length > 0 && (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Select
						value=""
						onChange={(e) => e.target.value && setAdded((a) => [...a, e.target.value])}
						className="w-auto"
						aria-label="Add a key for another provider"
					>
						<option value="">Add a key for another provider…</option>
						{addable.map((p) => (
							<option key={p.id} value={p.id}>
								{providerLabel(p.id, s.customName)}
							</option>
						))}
					</Select>
				</div>
			)}
		</Section>
	);
}

function KeyRow({ row, status, onChanged }: { row: KeyRowInfo; status: CredentialStatus; onChanged: () => Promise<void> }) {
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
				<Button onClick={() => call("save")} busy={busy === "save"} disabled={!value.trim() || busy !== null}>
					Save
				</Button>
				<Button onClick={() => call("test")} busy={busy === "test"} disabled={busy !== null || (!row.optional && status.source === "none")}>
					Test
				</Button>
				{status.source === "saved" && (
					<Button variant="ghost" onClick={() => call("clear")} busy={busy === "clear"} disabled={busy !== null}>
						Remove
					</Button>
				)}
			</div>
			{result && <p className={`text-xs sm:col-span-3 ${result.ok ? "text-success" : "text-error"}`}>{result.text}</p>}
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
	chat: "Chat replies",
	review: "Document reviews",
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
				<div className="panel p-4 text-sm">
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
						<table className="mt-4 w-full text-left text-sm">
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
									<tr key={task} className="border-t border-rule">
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
										{formatDateTime(r.at)}, {TASK_LABEL[r.task] ?? r.task}, {r.model}, {r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens} in / {r.outputTokens} out
										{r.costUsd !== null && `, ${formatUsd(r.costUsd)}`}
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
