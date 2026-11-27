export type StructuredOutputSupport = "json_schema" | "json_mode" | "none";

export interface ProviderCapabilities {
	readonly providerId: string;
	readonly modelId: string;
	readonly toolCalling: "native" | "none";
	readonly parallelToolCalls: boolean;
	readonly structuredOutput: StructuredOutputSupport;
	readonly streaming: boolean;
	readonly honoursAbortSignal: boolean;
	readonly maxContextTokens: number;
}

/** What one operation needs. Omitted fields are not required. */
export interface CapabilityRequirements {
	readonly toolCalling?: "native";
	readonly structuredOutput?: "json_schema" | "json_mode";
	readonly streaming?: true;
	readonly honoursAbortSignal?: true;
}

export type CapabilityKey = keyof CapabilityRequirements;

/** Recorded in the run result so every fallback is measurable. */
export type Degradation =
	| "structured_output:prompt_validated"
	| "streaming:disabled";

/** Set by policy, not by the provider. */
export interface CapabilityOptions {
	readonly allowStructuredOutputFallback: boolean;
	readonly allowStreamingFallback: boolean;
}

export type CapabilityCheck =
	| {
			readonly ok: true;
			readonly degradations: readonly Degradation[];
	}
	| {
			readonly ok: false;
			readonly missing: readonly CapabilityKey[];
			readonly degradations: readonly Degradation[];
		};
