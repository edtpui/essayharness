import type { ModelRef, Provider } from "@/lib/types";
import { getSettings } from "../db";
import { anthropicModels, anthropicObject, anthropicStream } from "./anthropic";
import { openaiModels, openaiObject, openaiStream } from "./openai";
import type { LlmRequest, ObjectResult, StructuredSpec, TextResult } from "./shared";

export type { Effort, LlmRequest } from "./shared";

export async function resolveModel(purpose: "main" | "extraction"): Promise<ModelRef> {
	const settings = await getSettings();
	return purpose === "extraction" && settings.extractionModel ? settings.extractionModel : settings.mainModel;
}

export function streamText(ref: ModelRef, req: LlmRequest, onDelta: (text: string) => void): Promise<TextResult> {
	return ref.provider === "anthropic" ? anthropicStream(ref.model, req, onDelta) : openaiStream(ref.provider, ref.model, req, onDelta);
}

export function generateObject<T>(ref: ModelRef, req: LlmRequest, spec: StructuredSpec<T>): Promise<ObjectResult<T>> {
	return ref.provider === "anthropic" ? anthropicObject(ref.model, req, spec) : openaiObject(ref.provider, ref.model, req, spec);
}

export function listModels(provider: Provider): Promise<string[]> {
	return provider === "anthropic" ? anthropicModels() : openaiModels(provider);
}
