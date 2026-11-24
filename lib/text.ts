import type { Limit } from "./types";

/** Whitespace-delimited tokens that contain a letter or digit — how word
 *  processors and most application portals count (a hyphenated or
 *  apostrophised word is one word; a lone dash is none). */
export function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	let n = 0;
	for (const token of trimmed.split(/\s+/)) {
		if (/[\p{L}\p{N}]/u.test(token)) n++;
	}
	return n;
}

/** Characters including spaces, counted as code points. */
export function countCharacters(text: string): number {
	return [...text].length;
}

export function measure(text: string, limit: Limit | null): { count: number; unit: "words" | "characters"; over: boolean } {
	const unit = limit?.unit ?? "words";
	const count = unit === "words" ? countWords(text) : countCharacters(text);
	return { count, unit, over: limit ? count > limit.value : false };
}

export function formatLimit(limit: Limit | null): string {
	if (!limit) return "No length limit";
	return `${limit.value.toLocaleString("en-US")} ${limit.unit}`;
}

/** Appends dictated or pasted text to a field, keeping one space or line break between parts. */
export function appendText(current: string, addition: string): string {
	const add = addition.trim();
	if (!add) return current;
	if (!current.trim()) return add;
	return /\s$/.test(current) ? current + add : `${current} ${add}`;
}

export function normalizeForMatch(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Jaccard overlap of word sets — used to avoid re-asking near-identical questions. */
export function similarity(a: string, b: string): number {
	const sa = new Set(normalizeForMatch(a).split(" ").filter(Boolean));
	const sb = new Set(normalizeForMatch(b).split(" ").filter(Boolean));
	if (sa.size === 0 || sb.size === 0) return 0;
	let shared = 0;
	for (const w of sa) if (sb.has(w)) shared++;
	return shared / (sa.size + sb.size - shared);
}

export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatUsd(value: number): string {
	if (value === 0) return "$0.00";
	if (value < 0.01) return "<$0.01";
	return `$${value.toFixed(2)}`;
}

/** Deepgram Nova-3 streaming endpoint for mono linear16 audio from the capture worklet. */
export function deepgramListenUrl(language: string, sampleRate = 16000): string {
	return (
		"wss://api.deepgram.com/v1/listen" +
		`?model=nova-3&encoding=linear16&sample_rate=${Math.round(sampleRate)}&channels=1` +
		"&smart_format=true&punctuate=true&interim_results=true&endpointing=300" +
		`&language=${encodeURIComponent(language)}`
	);
}

export const DICTATION_LANGUAGES: readonly { code: string; label: string }[] = [
	{ code: "en", label: "English" },
	{ code: "en-US", label: "English (US)" },
	{ code: "en-GB", label: "English (UK)" },
	{ code: "en-AU", label: "English (Australia)" },
	{ code: "en-IN", label: "English (India)" },
	{ code: "en-NZ", label: "English (New Zealand)" },
	{ code: "multi", label: "Multilingual (code-switching)" },
	{ code: "ar", label: "Arabic" },
	{ code: "zh-HK", label: "Chinese (Cantonese, Traditional)" },
	{ code: "zh-CN", label: "Chinese (Mandarin, Simplified)" },
	{ code: "zh-TW", label: "Chinese (Mandarin, Traditional)" },
	{ code: "fr", label: "French" },
	{ code: "fr-CA", label: "French (Canada)" },
	{ code: "de", label: "German" },
	{ code: "hi", label: "Hindi" },
	{ code: "it", label: "Italian" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "fa", label: "Persian" },
	{ code: "pt", label: "Portuguese" },
	{ code: "pa", label: "Punjabi" },
	{ code: "ru", label: "Russian" },
	{ code: "es", label: "Spanish" },
	{ code: "tl", label: "Tagalog" },
	{ code: "ta", label: "Tamil" },
	{ code: "uk", label: "Ukrainian" },
	{ code: "ur", label: "Urdu" },
	{ code: "vi", label: "Vietnamese" },
];
