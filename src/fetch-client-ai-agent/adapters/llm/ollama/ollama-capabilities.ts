import { ProviderCapabilities } from "../../../types/provider-capabilities";

export const OLLAMA_QWEN25_CODER_3B: ProviderCapabilities = {
	providerId: "ollama",
	modelId: "qwen2.5-coder:3b",
	toolCalling: "none",
	parallelToolCalls: false,
	structuredOutput: "none",
	streaming: true,
	honoursAbortSignal: true,
	maxContextTokens: 8192, // placeholder: verify against the model card
};
