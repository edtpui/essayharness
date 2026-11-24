import { z } from "zod";
import {
	CREDENTIALS,
	EntrySchema,
	EssaySchema,
	ExperienceSchema,
	InterviewSchema,
	ProfileSchema,
	SettingsSchema,
	type CredentialName,
	type CredentialStatus,
	type Interview,
	type Profile,
	type Settings,
} from "@/lib/types";
import { collection, nowIso, readSingleton, updateSingleton } from "./store";

export const entries = collection("entries", EntrySchema);
export const experiences = collection("experiences", ExperienceSchema);
export const essays = collection("essays", EssaySchema);

const defaultSettings = (): Settings => SettingsSchema.parse({});

export function getSettings(): Promise<Settings> {
	return readSingleton("settings", SettingsSchema, defaultSettings);
}

export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
	return updateSingleton("settings", SettingsSchema, defaultSettings, (current) => SettingsSchema.parse({ ...current, ...patch }));
}

const defaultProfile = (): Profile => ProfileSchema.parse({});

export function getProfile(): Promise<Profile> {
	return readSingleton("profile", ProfileSchema, defaultProfile);
}

export function saveProfile(input: Omit<Profile, "updatedAt">): Promise<Profile> {
	return updateSingleton("profile", ProfileSchema, defaultProfile, () => ({ ...input, updatedAt: nowIso() }));
}

const defaultInterview = (): Interview => InterviewSchema.parse({});

export function getInterview(): Promise<Interview> {
	return readSingleton("interview", InterviewSchema, defaultInterview);
}

export function updateInterview(fn: (current: Interview) => Interview): Promise<Interview> {
	return updateSingleton("interview", InterviewSchema, defaultInterview, fn);
}

/* API keys live in their own file so settings can be shown or exported
 * without them. The browser only ever receives a masked hint. */

const CredentialsSchema = z.object({
	anthropic: z.string().optional(),
	openai: z.string().optional(),
	custom: z.string().optional(),
	deepgram: z.string().optional(),
});
type Credentials = z.infer<typeof CredentialsSchema>;

export const CREDENTIAL_ENV: Record<CredentialName, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	custom: "CUSTOM_LLM_API_KEY",
	deepgram: "DEEPGRAM_API_KEY",
};

function readCredentials(): Promise<Credentials> {
	return readSingleton("credentials", CredentialsSchema, () => ({}));
}

export async function getCredential(name: CredentialName): Promise<string | undefined> {
	const saved = (await readCredentials())[name]?.trim();
	if (saved) return saved;
	const fromEnv = process.env[CREDENTIAL_ENV[name]]?.trim();
	return fromEnv || undefined;
}

export async function setCredential(name: CredentialName, value: string | null): Promise<void> {
	await updateSingleton("credentials", CredentialsSchema, () => ({}), (current) => {
		const next: Credentials = { ...current };
		if (value && value.trim()) next[name] = value.trim();
		else delete next[name];
		return next;
	});
}

function hint(key: string): string {
	return key.length > 8 ? `…${key.slice(-4)}` : "set";
}

export async function credentialStatuses(): Promise<Record<CredentialName, CredentialStatus>> {
	const saved = await readCredentials();
	const out = {} as Record<CredentialName, CredentialStatus>;
	for (const name of CREDENTIALS) {
		const savedKey = saved[name]?.trim();
		const envKey = process.env[CREDENTIAL_ENV[name]]?.trim();
		out[name] = savedKey
			? { source: "saved", hint: hint(savedKey) }
			: envKey
				? { source: "env", hint: `${CREDENTIAL_ENV[name]} ${hint(envKey)}` }
				: { source: "none", hint: "" };
	}
	return out;
}
