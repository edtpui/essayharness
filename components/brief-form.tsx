"use client";

import { useState, type FormEvent } from "react";
import type { EssayBriefInput, Limit } from "@/lib/types";
import { DictationField } from "./dictation";
import { Button, Field, Notice, Select, TextArea, TextInput } from "./ui";

export function BriefForm({
	initial,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	initial?: EssayBriefInput;
	submitLabel: string;
	onSubmit: (input: EssayBriefInput) => Promise<void>;
	onCancel?: () => void;
}) {
	const [title, setTitle] = useState(initial?.title ?? "");
	const [scholarship, setScholarship] = useState(initial?.scholarship ?? "");
	const [prompt, setPrompt] = useState(initial?.prompt ?? "");
	const [limitValue, setLimitValue] = useState(initial?.limit ? String(initial.limit.value) : "");
	const [limitUnit, setLimitUnit] = useState<Limit["unit"]>(initial?.limit?.unit ?? "words");
	const [criteria, setCriteria] = useState(initial?.criteria ?? "");
	const [notes, setNotes] = useState(initial?.notes ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		const parsed = limitValue.trim() ? Number(limitValue) : null;
		if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
			setError("The length limit must be a whole number, or leave it empty.");
			return;
		}
		setBusy(true);
		try {
			await onSubmit({ title, scholarship, prompt, limit: parsed === null ? null : { unit: limitUnit, value: parsed }, criteria, notes });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form onSubmit={submit} className="grid gap-3">
			<div className="grid gap-3 sm:grid-cols-2">
				<Field label="Essay title" htmlFor="brief-title" hint="For you, for example: Loran personal statement">
					<TextInput id="brief-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
				</Field>
				<Field label="Scholarship or program" htmlFor="brief-scholarship">
					<TextInput id="brief-scholarship" value={scholarship} onChange={(e) => setScholarship(e.target.value)} />
				</Field>
			</div>
			<Field label="Prompt" htmlFor="brief-prompt" hint="Paste the question exactly as the application asks it.">
				<TextArea id="brief-prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
			</Field>
			<div className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
				<Field label="Length limit" htmlFor="brief-limit">
					<TextInput id="brief-limit" inputMode="numeric" value={limitValue} onChange={(e) => setLimitValue(e.target.value.replace(/[^\d]/g, ""))} placeholder="None" />
				</Field>
				<Field label="Counted in">
					<Select value={limitUnit} onChange={(e) => setLimitUnit(e.target.value as Limit["unit"])}>
						<option value="words">Words</option>
						<option value="characters">Characters</option>
					</Select>
				</Field>
			</div>
			<Field label="Selection criteria and values" htmlFor="brief-criteria" hint="What the committee looks for, from the scholarship's website if they publish it.">
				<TextArea id="brief-criteria" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
			</Field>
			<Field label="Your notes" hint="Anything to emphasize or avoid, the tone you want, a story you already know you want to use.">
				<DictationField value={notes} onChange={setNotes} rows={2} micSize="sm" />
			</Field>
			{error && <Notice>{error}</Notice>}
			<div className="flex gap-2">
				<Button type="submit" variant="primary" busy={busy}>
					{submitLabel}
				</Button>
				{onCancel && (
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
