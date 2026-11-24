import { ChatMessageSchema, type ChatAction, type ChatEvent, type ChatMessage, type Essay } from "@/lib/types";
import { formatLimit, measure, truncate } from "@/lib/text";
import { createEntry, extractEntry } from "./bank";
import { essays, experiences, getProfile } from "./db";
import { HttpError, LlmError, errorMessage } from "./errors";
import { auditCore, currentAngle, generateCore, planCore } from "./essays";
import { generateObject, resolveModel } from "./llm";
import { CHAT_SYSTEM, ChatTurnSchema, chatPrompt } from "./prompts";
import { renderBank, renderBrief, renderProfile } from "./context";
import { withRun } from "./runs";
import { newId, nowIso } from "./store";

/* One chat turn: save the applicant's message, let the model reply and pick an
 * action, keep what they said in the bank, then run the action (plan, draft,
 * revise, fact check) inside the same run so Stop reaches all of it. */

const HISTORY_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 20_000;

function message(role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
	return ChatMessageSchema.parse({ id: newId("m"), createdAt: nowIso(), role, text, ...extra });
}

function renderSituation(essay: Essay): string {
	const angle = currentAngle(essay);
	const parts = [
		essay.plan
			? `<plan>\nAssessment: ${essay.plan.assessment}\nChosen angle: ${angle?.title ?? "(none)"} — ${angle?.pitch ?? ""}\nOther angles: ${
					essay.plan.angles.filter((a) => a !== angle).map((a) => a.title).join("; ") || "(none)"
				}\n</plan>`
			: "<plan>\nNot planned yet.\n</plan>",
	];
	const open = essay.questions.filter((q) => q.status === "open");
	parts.push(`<open_questions>\n${open.length ? open.map((q) => `[${q.id}] ${q.question}`).join("\n") : "(none)"}\n</open_questions>`);
	const latest = essay.versions.at(-1);
	if (latest) {
		const { count, unit } = measure(latest.text, essay.limit);
		parts.push(
			`<current_draft version="${essay.versions.length}" length="${count} ${unit}" limit="${formatLimit(essay.limit)}">\n${latest.text}\n</current_draft>`,
		);
	} else {
		parts.push("<current_draft>\nNo draft yet.\n</current_draft>");
	}
	return parts.join("\n\n");
}

export function renderHistory(messages: ChatMessage[]): string {
	const recent = messages.slice(-HISTORY_MESSAGES);
	const lines = recent.map((m, i) => {
		const who = m.role === "user" ? (i === recent.length - 1 ? "Applicant (latest)" : "Applicant") : "Coach";
		const note = m.role === "assistant" && m.versionId ? " [wrote a new draft version]" : "";
		return `${who}: ${truncate(m.text, 3000)}${note}`;
	});
	return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>`;
}

export function planSummary(essay: Essay): string {
	const plan = essay.plan;
	if (!plan) return "";
	const angle = currentAngle(essay);
	const open = essay.questions.filter((q) => q.status === "open");
	const lines = [plan.assessment];
	if (angle) lines.push(`I'd build it around "${angle.title}": ${angle.pitch}`);
	if (plan.angles.length > 1) lines.push("The other angles are in the plan panel if you'd rather go another way.");
	if (open.length) {
		lines.push(`To write it well, tell me:\n${open.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`);
		lines.push("Answer whichever you can, in any order, or ask me to draft now.");
	} else {
		lines.push("I have what I need. Say the word and I'll write the draft.");
	}
	return lines.join("\n\n");
}

function appendMessage(id: string, msg: ChatMessage): Promise<Essay> {
	return essays.update(id, "Essay", (e) => ({ ...e, updatedAt: msg.createdAt, messages: [...e.messages, msg] }));
}

function updateMessage(id: string, messageId: string, patch: Partial<ChatMessage>): Promise<Essay> {
	return essays.update(id, "Essay", (e) => ({ ...e, messages: e.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }));
}

export async function chatTurn(id: string, rawText: string, emit: (event: ChatEvent) => void): Promise<Essay> {
	const text = rawText.trim();
	if (!text) throw new HttpError(400, "Say something first.");
	if (text.length > MAX_MESSAGE_CHARS) throw new HttpError(413, `Messages are limited to ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`);

	return withRun(id, "chat", async (signal) => {
		// The message is saved before any model call, so it is never lost.
		const userMsg = message("user", text);
		let essay = await appendMessage(id, userMsg);
		emit({ type: "message", message: userMsg });
		emit({ type: "status", text: "Thinking…" });

		const [profile, bank, ref] = await Promise.all([getProfile(), experiences.list(), resolveModel("main")]);
		const context = [renderProfile(profile), renderBank(bank).text, renderBrief(essay), renderSituation(essay)].join("\n\n");
		const { object: turn } = await generateObject(
			ref,
			{
				task: "chat",
				essayId: id,
				system: CHAT_SYSTEM,
				context,
				prompt: `${renderHistory(essay.messages)}\n\n${chatPrompt()}`,
				effort: "medium",
				maxTokens: 8000,
				signal,
			},
			{ name: "chat_turn", schema: ChatTurnSchema },
		);

		// Keep what they told us verbatim, and sort it into the bank in the background.
		let entryId: string | null = null;
		if (turn.saveAsNote) {
			const entry = await createEntry({ text, source: "chat", essayId: id });
			entryId = entry.id;
			void extractEntry(entry.id).catch((err) => console.error(`[chat] sorting ${entry.id}:`, errorMessage(err)));
		}
		const answered = new Set(turn.answeredQuestionIds);
		const answeredAt = nowIso();
		essay = await essays.update(id, "Essay", (e) => ({
			...e,
			messages: e.messages.map((m) => (m.id === userMsg.id ? { ...m, entryId } : m)),
			questions: e.questions.map((q) =>
				q.status === "open" && answered.has(q.id) ? { ...q, status: "answered" as const, entryId, answeredAt } : q,
			),
		}));
		emit({ type: "message", message: { ...userMsg, entryId } });

		const hasDraft = essay.versions.length > 0;
		let action: ChatAction = turn.action;
		if (action === "revise" && !hasDraft) action = "draft";
		if (action === "check" && !hasDraft) action = "none";

		const reply = message("assistant", turn.reply.trim() || "Noted.", { action });
		essay = await appendMessage(id, reply);
		emit({ type: "message", message: reply });

		try {
			if (action === "plan") {
				emit({ type: "status", text: "Planning…" });
				essay = await planCore(id, signal);
				const follow = message("assistant", planSummary(essay));
				essay = await appendMessage(id, follow);
				emit({ type: "message", message: follow });
			} else if (action === "draft" || action === "revise") {
				emit({ type: "status", text: action === "draft" ? "Writing the draft…" : "Revising…" });
				const version = await generateCore(
					id,
					{ mode: action, instruction: turn.instruction.trim() || text },
					(delta) => emit({ type: "delta", text: delta }),
					signal,
				);
				essay = await updateMessage(id, reply.id, { versionId: version.id });
				emit({ type: "version", version });
			} else if (action === "check") {
				emit({ type: "status", text: "Checking facts…" });
				essay = await auditCore(id, undefined, signal);
				const audit = essay.audit!;
				const follow = message(
					"assistant",
					audit.issues.length
						? `${audit.summary}\n\nI highlighted ${audit.issues.length} spot${audit.issues.length === 1 ? "" : "s"} in the draft. Tell me what's actually true and I'll fix them.`
						: `${audit.summary} Everything in the draft is backed by what you've told me.`,
				);
				essay = await appendMessage(id, follow);
				emit({ type: "message", message: follow });
			}
		} catch (err) {
			const stopped = err instanceof LlmError && err.kind === "aborted";
			const failed = await updateMessage(id, reply.id, { error: stopped ? "Stopped." : errorMessage(err) });
			emit({ type: "essay", essay: failed });
			throw err;
		}
		emit({ type: "essay", essay });
		return essay;
	});
}
