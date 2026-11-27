import type {
	CapabilityCheck,
	CapabilityKey,
	CapabilityOptions,
	CapabilityRequirements,
	Degradation,
	ProviderCapabilities,
} from "../types/provider-capabilities";

/**
 * Tool calling and abort-signal support have no fallback: a missing one fails the check.
 * Tool calling is never emulated by parsing free text.
 * Degradations are returned on both branches so failed checks keep their diagnostics.
 */
export function checkCapabilities(
	caps: ProviderCapabilities,
	req: CapabilityRequirements,
	opts: CapabilityOptions,
): CapabilityCheck {
	const missing: CapabilityKey[] = [];
	const degradations: Degradation[] = [];

	if (req.toolCalling === "native" && caps.toolCalling !== "native") {
		missing.push("toolCalling");
	}

	if (req.honoursAbortSignal && !caps.honoursAbortSignal) {
		missing.push("honoursAbortSignal");
	}

	if (req.structuredOutput) {
		const satisfied =
			caps.structuredOutput === req.structuredOutput ||
			(req.structuredOutput === "json_mode" &&
				caps.structuredOutput === "json_schema");

		if (!satisfied) {
			if (opts.allowStructuredOutputFallback) {
				degradations.push("structured_output:prompt_validated");
			} else {
				missing.push("structuredOutput");
			}
		}
	}

	if (req.streaming && !caps.streaming) {
		if (opts.allowStreamingFallback) {
			degradations.push("streaming:disabled");
		} else {
			missing.push("streaming");
		}
	}

	return missing.length > 0
		? { ok: false, missing, degradations }
		: { ok: true, degradations };
}
