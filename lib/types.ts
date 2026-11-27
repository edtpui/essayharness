import { z } from "zod";
import { isProviderId } from "./providers";

/* Shared record shapes. Every stored file is validated against these on read,
 * so new optional fields must carry a default to keep older files readable. */

export const CATEGORIES = [
	"background",
	"academic",
	"leadership",
	"service",
	"work",
	"challenge",
	"achievement",
	"interest",
	"goal",
	"values",
	"other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
	background: "Background & identity",
	academic: "Academic",
	leadership: "Leadership",
	service: "Service & community",
	work: "Work & responsibilities",
	challenge: "Challenges",
	achievement: "Achievements",
	interest: "Interests",
	goal: "Goals",
	values: "Values & influences",
	other: "Other",
};

const isoDate = z.string();

export const ExperienceSchema = z.object({
	id: z.string(),
	title: z.string(),
	category: z.enum(CATEGORIES),
	timeframe: z.string().default(""),
	summary: z.string().default(""),
	role: z.string().default(""),
	details: z.string().default(""),
	actions: z.string().default(""),
	outcomes: z.string().default(""),
	reflections: z.string().default(""),
	skills: z.array(z.string()).default([]),
	people: z.array(z.string()).default([]),
	quotes: z.array(z.string()).default([]),
	sourceEntryIds: z.array(z.string()).default([]),
	createdAt: isoDate,
	updatedAt: isoDate,
});
export type Experience = z.infer<typeof ExperienceSchema>;

/** Fields a person edits directly. */
export const ExperienceInputSchema = z.object({
	title: z.string().trim().min(1, "Title is required").max(200),
	category: z.enum(CATEGORIES),
	timeframe: z.string().max(200),
	summary: z.string().max(4000),
	role: z.string().max(1000),
	details: z.string().max(20000),
	actions: z.string().max(20000),
	outcomes: z.string().max(20000),
	reflections: z.string().max(20000),
	skills: z.array(z.string().max(100)).max(50),
	people: z.array(z.string().max(200)).max(50),
	quotes: z.array(z.string().max(1000)).max(30),
});
export type ExperienceInput = z.infer<typeof ExperienceInputSchema>;

export const ENTRY_SOURCES = ["dictation", "typed", "interview", "import", "chat"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ExtractionSchema = z.object({
	status: z.enum(["pending", "running", "done", "failed"]),
	error: z.string().default(""),
	experienceIds: z.array(z.string()).default([]),
	at: z.string().default(""),
	model: z.string().default(""),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const DOCUMENT_KINDS = ["essay", "story", "resume", "notes", "other"] as const;

export const ReviewSchema = z.object({
	status: z.enum(["pending", "running", "done", "failed"]),
	error: z.string().default(""),
	kind: z.enum(DOCUMENT_KINDS).default("other"),
	summary: z.string().default(""),
	strengths: z.array(z.string()).default([]),
	weaknesses: z.array(z.string()).default([]),
	suggestions: z.array(z.string()).default([]),
	goodFor: z.array(z.string()).default([]),
	at: z.string().default(""),
	model: z.string().default(""),
});
export type Review = z.infer<typeof ReviewSchema>;

export const EntrySchema = z.object({
	id: z.string(),
	createdAt: isoDate,
	updatedAt: isoDate,
	source: z.enum(ENTRY_SOURCES),
	title: z.string().default(""),
	/** The question this note answers, if any. */
	prompt: z.string().default(""),
	text: z.string(),
	essayId: z.string().nullable().default(null),
	questionId: z.string().nullable().default(null),
	interviewQuestionId: z.string().nullable().default(null),
	/** The applicant's own finished writing, used as a voice reference when drafting. */
	writingSample: z.boolean().default(false),
	extraction: ExtractionSchema,
	/** For uploaded documents: the coach's review of the piece. */
	review: ReviewSchema.nullable().default(null),
});
export type Entry = z.infer<typeof EntrySchema>;

export const ProfileSchema = z.object({
	name: z.string().default(""),
	education: z.string().default(""),
	field: z.string().default(""),
	goals: z.string().default(""),
	location: z.string().default(""),
	other: z.string().default(""),
	updatedAt: z.string().default(""),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileInputSchema = z.object({
	name: z.string().max(200),
	education: z.string().max(2000),
	field: z.string().max(2000),
	goals: z.string().max(4000),
	location: z.string().max(500),
	other: z.string().max(8000),
});

/* ---------- experience bank export / import ---------- */

/** A whole experience bank in one file: the profile, every note, and every
 *  experience sorted from them. Essays, settings, and API keys are not part
 *  of the bank and are never exported. */
export const BankExportSchema = z.object({
	app: z.literal("essayharness"),
	kind: z.literal("experience-bank"),
	version: z.literal(1),
	exportedAt: z.string().default(""),
	profile: ProfileSchema.nullable().default(null),
	entries: z.array(EntrySchema).max(10_000).default([]),
	experiences: z.array(ExperienceSchema).max(10_000).default([]),
});
export type BankExport = z.infer<typeof BankExportSchema>;

export interface BankImportResult {
	entriesAdded: number;
	entriesSkipped: number;
	experiencesAdded: number;
	experiencesSkipped: number;
	profileImported: boolean;
}

export const LimitSchema = z.object({
	unit: z.enum(["words", "characters"]),
	value: z.number().int().min(1).max(100000),
});
export type Limit = z.infer<typeof LimitSchema>;

export const OutlineBeatSchema = z.object({
	beat: z.string(),
	experienceIds: z.array(z.string()).default([]),
});

export const AngleSchema = z.object({
	title: z.string(),
	pitch: z.string(),
	experienceIds: z.array(z.string()).default([]),
	outline: z.array(OutlineBeatSchema).default([]),
});
export type Angle = z.infer<typeof AngleSchema>;

export const PlanSchema = z.object({
	createdAt: isoDate,
	model: z.string(),
	assessment: z.string(),
	angles: z.array(AngleSchema),
	recommendedAngle: z.number().int(),
	ready: z.boolean(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const QuestionSchema = z.object({
	id: z.string(),
	createdAt: isoDate,
	question: z.string(),
	why: z.string().default(""),
	priority: z.enum(["critical", "helpful"]),
	status: z.enum(["open", "answered", "skipped"]),
	entryId: z.string().nullable().default(null),
	answeredAt: z.string().nullable().default(null),
});
export type Question = z.infer<typeof QuestionSchema>;

export const VERSION_KINDS = ["draft", "revision", "tighten", "manual"] as const;
export const VersionSchema = z.object({
	id: z.string(),
	createdAt: isoDate,
	kind: z.enum(VERSION_KINDS),
	text: z.string(),
	words: z.number().int(),
	characters: z.number().int(),
	model: z.string().default(""),
	instruction: z.string().default(""),
	angle: z.string().default(""),
});
export type Version = z.infer<typeof VersionSchema>;

export const AUDIT_PROBLEMS = ["unsupported", "embellished", "contradiction"] as const;
export const AuditIssueSchema = z.object({
	excerpt: z.string(),
	problem: z.enum(AUDIT_PROBLEMS),
	explanation: z.string(),
	suggestion: z.string(),
});
export type AuditIssue = z.infer<typeof AuditIssueSchema>;

export const AuditSchema = z.object({
	versionId: z.string(),
	createdAt: isoDate,
	model: z.string(),
	summary: z.string(),
	issues: z.array(AuditIssueSchema),
});
export type Audit = z.infer<typeof AuditSchema>;

export const CHAT_ACTIONS = ["none", "plan", "draft", "revise", "check"] as const;
export type ChatAction = (typeof CHAT_ACTIONS)[number];

export const ChatMessageSchema = z.object({
	id: z.string(),
	createdAt: isoDate,
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	/** User message saved into the bank as a note. */
	entryId: z.string().nullable().default(null),
	/** Assistant message: the work it did and what that produced. */
	action: z.enum(CHAT_ACTIONS).default("none"),
	versionId: z.string().nullable().default(null),
	error: z.string().default(""),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const EssaySchema = z.object({
	id: z.string(),
	createdAt: isoDate,
	updatedAt: isoDate,
	title: z.string(),
	scholarship: z.string().default(""),
	prompt: z.string(),
	limit: LimitSchema.nullable().default(null),
	criteria: z.string().default(""),
	notes: z.string().default(""),
	plan: PlanSchema.nullable().default(null),
	selectedAngle: z.number().int().default(0),
	questions: z.array(QuestionSchema).default([]),
	versions: z.array(VersionSchema).default([]),
	audit: AuditSchema.nullable().default(null),
	messages: z.array(ChatMessageSchema).default([]),
});
export type Essay = z.infer<typeof EssaySchema>;

export const EssayBriefInputSchema = z.object({
	title: z.string().trim().min(1, "Give the essay a title").max(300),
	scholarship: z.string().max(300),
	prompt: z.string().trim().min(1, "Paste the essay prompt").max(10000),
	limit: LimitSchema.nullable(),
	criteria: z.string().max(10000),
	notes: z.string().max(10000),
});
export type EssayBriefInput = z.infer<typeof EssayBriefInputSchema>;

export const InterviewQuestionSchema = z.object({
	id: z.string(),
	question: z.string(),
	theme: z.string().default(""),
	why: z.string().default(""),
	status: z.enum(["open", "answered", "skipped"]),
	entryId: z.string().nullable().default(null),
});
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;

export const InterviewSchema = z.object({
	createdAt: z.string().default(""),
	model: z.string().default(""),
	questions: z.array(InterviewQuestionSchema).default([]),
});
export type Interview = z.infer<typeof InterviewSchema>;

/** A model provider id from lib/providers.ts. */
export type Provider = string;

export const ModelRefSchema = z.object({
	provider: z.string().refine(isProviderId, "Unknown provider"),
	model: z.string().trim().min(1, "Choose a model").max(200),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const SettingsSchema = z.object({
	mainModel: ModelRefSchema.default({ provider: "anthropic", model: "claude-opus-5-5" }),
	/** Model for sorting notes into the bank; null means "same as main". */
	extractionModel: ModelRefSchema.nullable().default(null),
	customBaseUrl: z.string().default("http://localhost:11434/v1"),
	customName: z.string().default("Local model"),
	dictationLanguage: z.string().default("en"),
	/** The most gap questions one planning pass may ask; null lets the model decide. */
	maxQuestions: z.number().int().min(1).max(12).nullable().default(6),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsInputSchema = z.object({
	mainModel: ModelRefSchema,
	extractionModel: ModelRefSchema.nullable(),
	customBaseUrl: z
		.string()
		.trim()
		.max(500)
		.refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Base URL must start with http:// or https://"),
	customName: z.string().trim().max(100),
	dictationLanguage: z.string().trim().min(2).max(20),
	maxQuestions: z.number().int().min(1).max(12).nullable(),
});

/** A provider id, or "deepgram". */
export type CredentialName = string;

export interface CredentialStatus {
	source: "saved" | "env" | "none";
	hint: string;
}

export interface SettingsView {
	settings: Settings;
	credentials: Record<string, CredentialStatus>;
	dataDir: string;
}

export const USAGE_TASKS = ["extract", "plan", "interview", "draft", "revise", "tighten", "audit", "chat", "review", "test"] as const;
export type UsageTask = (typeof USAGE_TASKS)[number];

export interface UsageRecord {
	at: string;
	task: UsageTask;
	provider: Provider;
	model: string;
	essayId: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd: number | null;
}

export interface UsageSummary {
	totalCostUsd: number;
	unpricedCalls: number;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	byTask: Record<string, { calls: number; costUsd: number; inputTokens: number; outputTokens: number }>;
	byEssay: Record<string, number>;
	recent: UsageRecord[];
}

/** Streamed generation protocol: one JSON object per line. */
/** Streamed chat turn protocol: one JSON object per line. */
export type ChatEvent =
	| { type: "message"; message: ChatMessage }
	| { type: "status"; text: string }
	| { type: "delta"; text: string }
	| { type: "version"; version: Version }
	| { type: "essay"; essay: Essay }
	| { type: "error"; message: string };

export type GenerationEvent =
	| { type: "delta"; text: string }
	| { type: "done"; version: Version }
	| { type: "error"; message: string };

export const GRAPH_NODE_KINDS = ["experience", "skill", "person", "essay", "document"] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export interface GraphNode {
	id: string;
	kind: GraphNodeKind;
	label: string;
	/** Experience category, for colouring. */
	category?: Category;
	detail: string;
	href?: string;
}

export interface GraphEdge {
	source: string;
	target: string;
	kind: "shows" | "involves" | "uses" | "from";
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}
