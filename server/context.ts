import { CATEGORY_LABELS, type Angle, type Entry, type Essay, type Experience, type Profile, type Question } from "@/lib/types";
import { formatLimit, truncate } from "@/lib/text";

/* Renders the applicant's material into the tagged text the prompts expect.
 * Order is kept stable (oldest first) so the cacheable prefix of a request
 * changes as little as possible between calls. */

export const BANK_BUDGET_CHARS = 150_000;

export function byCreated<T extends { createdAt: string }>(items: T[]): T[] {
	return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function renderExperience(e: Experience): string {
	const meta = [CATEGORY_LABELS[e.category], e.timeframe.trim()].filter(Boolean).join(", ");
	const lines = [`[${e.id}] ${e.title}${meta ? ` (${meta})` : ""}`];
	const add = (label: string, value: string) => {
		if (value.trim()) lines.push(`${label}: ${value.trim()}`);
	};
	add("Summary", e.summary);
	add("Role", e.role);
	add("What happened", e.details);
	add("What I did", e.actions);
	add("Outcomes", e.outcomes);
	add("Reflections", e.reflections);
	if (e.skills.length) lines.push(`Shows: ${e.skills.join(", ")}`);
	if (e.people.length) lines.push(`People: ${e.people.join("; ")}`);
	if (e.quotes.length) lines.push(`In my words: ${e.quotes.map((q) => `"${q}"`).join(" ")}`);
	return lines.join("\n");
}

export function renderIndexLine(e: Experience): string {
	return `[${e.id}] ${e.title} — ${e.category}${e.timeframe ? `, ${e.timeframe}` : ""}: ${truncate(e.summary || e.details, 300)}`;
}

export function renderBankIndex(list: Experience[]): string {
	return `<bank_index>\n${list.length ? byCreated(list).map(renderIndexLine).join("\n") : "(empty)"}\n</bank_index>`;
}

/** The whole bank in full, or an index of it when it is too large to send whole. */
export function renderBank(list: Experience[], budget = BANK_BUDGET_CHARS): { text: string; complete: boolean } {
	if (!list.length) return { text: "<experience_bank>\n(empty)\n</experience_bank>", complete: true };
	const ordered = byCreated(list);
	const full = ordered.map(renderExperience).join("\n\n");
	if (full.length <= budget) return { text: `<experience_bank count="${list.length}">\n${full}\n</experience_bank>`, complete: true };
	const index = ordered.map(renderIndexLine).join("\n");
	return {
		text: `<experience_bank count="${list.length}" detail="summaries only, the full bank is too large">\n${index}\n</experience_bank>`,
		complete: false,
	};
}

export function renderProfile(p: Profile): string {
	const rows: [string, string][] = [
		["Name", p.name],
		["Education", p.education],
		["Intended field of study", p.field],
		["Goals", p.goals],
		["Location", p.location],
		["Other facts", p.other],
	];
	const body = rows.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);
	return `<profile>\n${body.length ? body.join("\n") : "(not filled in)"}\n</profile>`;
}

export function renderBrief(essay: Essay): string {
	const lines = [
		essay.scholarship.trim() ? `Scholarship or program: ${essay.scholarship.trim()}` : "",
		`Essay: ${essay.title.trim()}`,
		`Prompt:\n${essay.prompt.trim()}`,
		`Length limit: ${formatLimit(essay.limit)}`,
		essay.criteria.trim() ? `Selection criteria and values:\n${essay.criteria.trim()}` : "",
		essay.notes.trim() ? `The applicant's notes for this essay:\n${essay.notes.trim()}` : "",
	].filter(Boolean);
	return `<essay_brief>\n${lines.join("\n\n")}\n</essay_brief>`;
}

export interface AnswerPair {
	question: string;
	answer: string;
}

export function renderAnswers(pairs: AnswerPair[]): string {
	if (!pairs.length) return "";
	const body = pairs.map((p) => `Q: ${p.question.trim()}\nA: ${p.answer.trim()}`).join("\n\n");
	return `<answers note="The applicant's own answers to questions about this essay">\n${body}\n</answers>`;
}

export function renderPreviousQuestions(questions: Question[]): string {
	if (!questions.length) return "<previous_questions>\n(none)\n</previous_questions>";
	return `<previous_questions>\n${questions.map((q) => `- (${q.status}) ${q.question}`).join("\n")}\n</previous_questions>`;
}

export interface VoiceSample {
	label: string;
	text: string;
}

export function renderVoiceSamples(samples: VoiceSample[]): string {
	if (!samples.length) return "";
	const body = samples.map((s) => `--- ${s.label} ---\n${s.text.trim()}`).join("\n\n");
	return `<voice_samples note="The applicant's own words. Match their voice; facts here are valid material too.">\n${body}\n</voice_samples>`;
}

export function renderAngle(angle: Angle | null): string {
	if (!angle) return "<chosen_angle>\nNone chosen: pick the strongest angle the material supports.\n</chosen_angle>";
	const outline = angle.outline.length
		? angle.outline
				.map((b, i) => `${i + 1}. ${b.beat}${b.experienceIds.length ? ` [${b.experienceIds.join(", ")}]` : ""}`)
				.join("\n")
		: "(none)";
	return `<chosen_angle>\nTitle: ${angle.title}\nPitch: ${angle.pitch}\nOutline:\n${outline}\n</chosen_angle>`;
}

export function renderNote(entry: Entry): string {
	const date = entry.createdAt.slice(0, 10);
	const attrs = [`source="${entry.source}"`, `date="${date}"`, entry.title ? `title="${entry.title.replace(/"/g, "'")}"` : ""]
		.filter(Boolean)
		.join(" ");
	const question = entry.prompt.trim() ? `<question>${entry.prompt.trim()}</question>\n` : "";
	return `<note ${attrs}>\n${question}${entry.text.trim()}\n</note>`;
}

/** What the applicant has said in this essay's chat: their own words, so valid material. Newest kept when long. */
export function renderConversation(userMessages: string[], budget = 30_000): string {
	const kept: string[] = [];
	let used = 0;
	for (let i = userMessages.length - 1; i >= 0; i--) {
		const text = userMessages[i]!.trim();
		if (!text) continue;
		if (used + text.length > budget) break;
		kept.unshift(text);
		used += text.length;
	}
	if (!kept.length) return "";
	return `<conversation note="What the applicant has told you in this essay's chat, oldest first">\n${kept.map((t) => `- ${t}`).join("\n")}\n</conversation>`;
}
