import { InterviewQuestionSchema, type Interview } from "@/lib/types";
import { similarity } from "@/lib/text";
import { experiences, getInterview, getProfile, updateInterview } from "./db";
import { HttpError } from "./errors";
import { generateObject, resolveModel } from "./llm";
import { InterviewResultSchema, interviewPrompt, interviewSystem } from "./prompts";
import { renderBank, renderProfile } from "./context";
import { newId, nowIso, withLock } from "./store";

/** Asks the model which life themes the bank is missing and stores its questions. */
export async function generateInterview(count = 6): Promise<Interview> {
	return withLock("interview-run", async () => {
		const [profile, bank, current, ref] = await Promise.all([getProfile(), experiences.list(), getInterview(), resolveModel("main")]);
		const asked = current.questions.map((q) => `- (${q.status}) ${q.question}`).join("\n");
		const context = [
			renderProfile(profile),
			renderBank(bank, 60_000).text,
			`<already_asked>\n${asked || "(none)"}\n</already_asked>`,
		].join("\n\n");
		const { object, model } = await generateObject(
			ref,
			{ task: "interview", system: interviewSystem(count), context, prompt: interviewPrompt(), effort: "medium", maxTokens: 8000 },
			{ name: "interview_questions", schema: InterviewResultSchema },
		);
		return updateInterview((iv) => {
			const questions = [...iv.questions];
			for (const q of object.questions) {
				const text = q.question.trim();
				if (!text || questions.some((existing) => similarity(existing.question, text) >= 0.7)) continue;
				questions.push(
					InterviewQuestionSchema.parse({ id: newId("iq"), question: text, theme: q.theme.trim(), why: q.why.trim(), status: "open" }),
				);
			}
			return { createdAt: nowIso(), model, questions };
		});
	});
}

export async function setInterviewQuestionStatus(id: string, status: "open" | "skipped"): Promise<Interview> {
	return updateInterview((iv) => {
		const question = iv.questions.find((q) => q.id === id);
		if (!question) throw new HttpError(404, "Interview question not found");
		if (question.status === "answered") throw new HttpError(409, "That question is already answered.");
		return { ...iv, questions: iv.questions.map((q) => (q.id === id ? { ...q, status } : q)) };
	});
}
