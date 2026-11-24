/* Model providers, matching the API-key providers EssayHarness offers (its
 * pi-ai catalog, v1.5.2). Anthropic is called through its own SDK; everything
 * else speaks the OpenAI API, mostly Chat Completions, and Meta the Responses
 * API. Providers whose native API is Anthropic- or Google-style use their
 * OpenAI-compatible endpoints here. Browser-safe: no secrets, no I/O. */

export type ProviderApi = "anthropic" | "chat" | "responses";

export interface ProviderInfo {
	id: string;
	label: string;
	/** Environment variable the key can come from (EssayHarness uses the same names). */
	envVar: string;
	api: ProviderApi;
	/** Fixed base URL; the custom endpoint takes its URL from Settings. */
	baseURL: string;
	/** Suggested model ids; "List models" asks the provider for the full set. */
	models: string[];
	keyHelp: string;
	keyOptional?: boolean;
}

export const PROVIDER_LIST: readonly ProviderInfo[] = [
	{ id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", api: "anthropic", baseURL: "https://api.anthropic.com", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"], keyHelp: "console.anthropic.com, API keys" },
	{ id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", api: "chat", baseURL: "https://api.openai.com/v1", models: [], keyHelp: "platform.openai.com, API keys" },
	{ id: "google", label: "Google (Gemini)", envVar: "GEMINI_API_KEY", api: "chat", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-2.5-pro", "gemini-2.5-flash"], keyHelp: "aistudio.google.com, Get API key" },
	{ id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", api: "chat", baseURL: "https://openrouter.ai/api/v1", models: ["~anthropic/claude-opus-latest", "~anthropic/claude-sonnet-latest"], keyHelp: "openrouter.ai, Keys" },
	{ id: "xai", label: "xAI", envVar: "XAI_API_KEY", api: "chat", baseURL: "https://api.x.ai/v1", models: ["grok-4.7", "grok-4.6"], keyHelp: "console.x.ai" },
	{ id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY", api: "chat", baseURL: "https://api.mistral.ai/v1", models: ["mistral-large-latest", "mistral-medium-latest"], keyHelp: "console.mistral.ai, API keys" },
	{ id: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY", api: "chat", baseURL: "https://api.deepseek.com", models: ["deepseek-v4-pro", "deepseek-flash"], keyHelp: "platform.deepseek.com, API keys" },
	{ id: "groq", label: "Groq", envVar: "GROQ_API_KEY", api: "chat", baseURL: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"], keyHelp: "console.groq.com, API keys" },
	{ id: "together", label: "Together", envVar: "TOGETHER_API_KEY", api: "chat", baseURL: "https://api.together.ai/v1", models: ["deepseek-ai/DeepSeek-V4-Pro-0813", "MiniMaxAI/MiniMax-M3"], keyHelp: "api.together.ai, Settings, API keys" },
	{ id: "fireworks", label: "Fireworks", envVar: "FIREWORKS_API_KEY", api: "chat", baseURL: "https://api.fireworks.ai/inference/v1", models: ["accounts/fireworks/models/deepseek-v4p1-flash", "accounts/fireworks/models/minimax-m3"], keyHelp: "fireworks.ai, API keys" },
	{ id: "cerebras", label: "Cerebras", envVar: "CEREBRAS_API_KEY", api: "chat", baseURL: "https://api.cerebras.ai/v1", models: ["gpt-oss-120b", "qwen-3.8-27b"], keyHelp: "cloud.cerebras.ai, API keys" },
	{ id: "huggingface", label: "Hugging Face", envVar: "HF_TOKEN", api: "chat", baseURL: "https://router.huggingface.co/v1", models: ["deepseek-ai/DeepSeek-V3-0324"], keyHelp: "huggingface.co, Settings, Access tokens" },
	{ id: "nvidia", label: "NVIDIA", envVar: "NVIDIA_API_KEY", api: "chat", baseURL: "https://integrate.api.nvidia.com/v1", models: ["deepseek-ai/deepseek-v4.1-flash"], keyHelp: "build.nvidia.com, API key" },
	{ id: "baseten", label: "Baseten", envVar: "BASETEN_API_KEY", api: "chat", baseURL: "https://inference.baseten.co/v1", models: ["deepseek-ai/DeepSeek-V4-Pro-0813"], keyHelp: "app.baseten.co, API keys" },
	{ id: "vercel-ai-gateway", label: "Vercel AI Gateway", envVar: "AI_GATEWAY_API_KEY", api: "chat", baseURL: "https://ai-gateway.vercel.sh/v1", models: ["anthropic/claude-opus-5-5", "openai/gpt-5"], keyHelp: "vercel.com, AI Gateway, API keys" },
	{ id: "opencode", label: "OpenCode Zen", envVar: "OPENCODE_API_KEY", api: "chat", baseURL: "https://opencode.ai/inference/openai/v1", models: [], keyHelp: "opencode.ai, Zen" },
	{ id: "opencode-go", label: "OpenCode Go", envVar: "OPENCODE_API_KEY", api: "chat", baseURL: "https://opencode.ai/inference/go/openai/v1", models: ["qwen3.7-plus", "minimax-m3"], keyHelp: "opencode.ai, Go" },
	{ id: "meta", label: "Meta", envVar: "META_API_KEY", api: "responses", baseURL: "https://api.meta.ai/v1", models: ["muse-spark-1.2", "muse-ember-1.0"], keyHelp: "Meta developer console, API keys" },
	{ id: "moonshotai", label: "Moonshot AI", envVar: "MOONSHOT_API_KEY", api: "chat", baseURL: "https://api.moonshot.ai/v1", models: ["kimi-k3", "kimi-k2.6"], keyHelp: "platform.moonshot.ai, API keys" },
	{ id: "moonshotai-cn", label: "Moonshot AI CN", envVar: "MOONSHOT_API_KEY", api: "chat", baseURL: "https://api.moonshot.cn/v1", models: ["kimi-k3", "kimi-k2.6"], keyHelp: "platform.moonshot.cn, API keys" },
	{ id: "kimi-coding", label: "Kimi For Coding", envVar: "KIMI_API_KEY", api: "chat", baseURL: "https://api.kimi.com/coding/v1", models: ["k3.1-pro", "k3"], keyHelp: "kimi.com, Kimi for Coding" },
	{ id: "minimax", label: "MiniMax", envVar: "MINIMAX_API_KEY", api: "chat", baseURL: "https://api.minimax.io/v1", models: ["MiniMax-M3", "MiniMax-M2.7"], keyHelp: "platform.minimax.io, API keys" },
	{ id: "minimax-cn", label: "MiniMax CN", envVar: "MINIMAX_CN_API_KEY", api: "chat", baseURL: "https://api.minimaxi.com/v1", models: ["MiniMax-M3", "MiniMax-M2.7"], keyHelp: "platform.minimaxi.com, API keys" },
	{ id: "zai", label: "Z.AI", envVar: "ZAI_API_KEY", api: "chat", baseURL: "https://api.z.ai/api/coding/paas/v4", models: ["glm-5.2", "glm-4.7"], keyHelp: "z.ai, API keys" },
	{ id: "zai-coding-cn", label: "Z.AI Coding CN", envVar: "ZAI_CODING_CN_API_KEY", api: "chat", baseURL: "https://open.bigmodel.cn/api/coding/paas/v4", models: ["glm-5.3", "glm-5.3-flash"], keyHelp: "open.bigmodel.cn, API keys" },
	{ id: "ant-ling", label: "Ant Ling", envVar: "ANT_LING_API_KEY", api: "chat", baseURL: "https://api.ant-ling.com/v1", models: ["Ling-2.6-1T", "Ling-2.6-flash"], keyHelp: "ant-ling.com, API keys" },
	{ id: "qwen-token-plan", label: "Qwen Token Plan", envVar: "QWEN_TOKEN_PLAN_API_KEY", api: "chat", baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", models: [], keyHelp: "Alibaba Cloud Model Studio, Token Plan" },
	{ id: "qwen-token-plan-cn", label: "Qwen Token Plan CN", envVar: "QWEN_TOKEN_PLAN_CN_API_KEY", api: "chat", baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", models: [], keyHelp: "Alibaba Cloud Bailian, Token Plan" },
	{ id: "qwen-token-plan-individual", label: "Qwen Token Plan Individual", envVar: "QWEN_TOKEN_PLAN_API_KEY", api: "chat", baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", models: [], keyHelp: "Alibaba Cloud Model Studio, Token Plan" },
	{ id: "qwen-token-plan-individual-cn", label: "Qwen Token Plan Individual CN", envVar: "QWEN_TOKEN_PLAN_CN_API_KEY", api: "chat", baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", models: [], keyHelp: "Alibaba Cloud Bailian, Token Plan" },
	{ id: "xiaomi", label: "Xiaomi", envVar: "XIAOMI_API_KEY", api: "chat", baseURL: "https://api.xiaomimimo.com/v1", models: ["mimo-v2.6-pro", "mimo-v2.6-flash"], keyHelp: "xiaomimimo.com, API keys" },
	{ id: "xiaomi-token-plan-ams", label: "Xiaomi Token Plan AMS", envVar: "XIAOMI_TOKEN_PLAN_AMS_API_KEY", api: "chat", baseURL: "https://token-plan-ams.xiaomimimo.com/v1", models: ["mimo-v2.6-pro", "mimo-v2.6-flash"], keyHelp: "xiaomimimo.com, Token Plan" },
	{ id: "xiaomi-token-plan-cn", label: "Xiaomi Token Plan CN", envVar: "XIAOMI_TOKEN_PLAN_CN_API_KEY", api: "chat", baseURL: "https://token-plan-cn.xiaomimimo.com/v1", models: ["mimo-v2.6-pro", "mimo-v2.6-flash"], keyHelp: "xiaomimimo.com, Token Plan" },
	{ id: "xiaomi-token-plan-sgp", label: "Xiaomi Token Plan SGP", envVar: "XIAOMI_TOKEN_PLAN_SGP_API_KEY", api: "chat", baseURL: "https://token-plan-sgp.xiaomimimo.com/v1", models: ["mimo-v2.6-pro", "mimo-v2.6-flash"], keyHelp: "xiaomimimo.com, Token Plan" },
	{ id: "custom", label: "Custom endpoint", envVar: "CUSTOM_LLM_API_KEY", api: "chat", baseURL: "", models: [], keyHelp: "Only if your endpoint needs one (OpenRouter-style services do; Ollama doesn't)", keyOptional: true },
];

export const PROVIDER_IDS: readonly string[] = PROVIDER_LIST.map((p) => p.id);
const BY_ID = new Map(PROVIDER_LIST.map((p) => [p.id, p]));

export function providerInfo(id: string): ProviderInfo | undefined {
	return BY_ID.get(id);
}

export function isProviderId(id: string): boolean {
	return BY_ID.has(id);
}

export function providerLabel(id: string, customName = ""): string {
	if (id === "custom" && customName.trim()) return customName.trim();
	return BY_ID.get(id)?.label ?? id;
}

/** Keys the app stores: every model provider, plus Deepgram for dictation. */
export const CREDENTIAL_IDS: readonly string[] = [...PROVIDER_IDS, "deepgram"];

export function credentialEnvVar(id: string): string | undefined {
	return id === "deepgram" ? "DEEPGRAM_API_KEY" : BY_ID.get(id)?.envVar;
}
