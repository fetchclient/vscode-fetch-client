import { describe, it, expect } from "vitest";
import { checkCapabilities } from "../../../fetch-client-ai-agent/services/capability-check";
import type {
	CapabilityOptions,
	CapabilityRequirements,
	ProviderCapabilities,
} from "../../../fetch-client-ai-agent/types/provider-capabilities";

function makeCapabilities(
	overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
	return {
		providerId: "test-provider",
		modelId: "test-model",
		toolCalling: "native",
		parallelToolCalls: true,
		structuredOutput: "json_schema",
		streaming: true,
		honoursAbortSignal: true,
		maxContextTokens: 128000,
		...overrides,
	};
}

const noFallbacks: CapabilityOptions = {
	allowStructuredOutputFallback: false,
	allowStreamingFallback: false,
};

const allFallbacks: CapabilityOptions = {
	allowStructuredOutputFallback: true,
	allowStreamingFallback: true,
};

describe("capability-check", () => {
	describe("checkCapabilities", () => {
		it("should succeed with no degradations when requirements are empty", () => {
			const caps = makeCapabilities({
				toolCalling: "none",
				structuredOutput: "none",
				streaming: false,
				honoursAbortSignal: false,
			});

			const result = checkCapabilities(caps, {}, noFallbacks);

			expect(result).toEqual({
				ok: true,
				degradations: [],
			});
		});

		it("should succeed with no degradations when all requirements are satisfied", () => {
			const caps = makeCapabilities();
			const req: CapabilityRequirements = {
				toolCalling: "native",
				structuredOutput: "json_schema",
				streaming: true,
				honoursAbortSignal: true,
			};

			const result = checkCapabilities(caps, req, noFallbacks);

			expect(result).toEqual({
				ok: true,
				degradations: [],
			});
		});

		describe("toolCalling", () => {
			it("should fail when native tool calling is required but provider has none, even with fallbacks enabled", () => {
				const caps = makeCapabilities({ toolCalling: "none" });

				const result = checkCapabilities(
					caps,
					{ toolCalling: "native" },
					allFallbacks,
				);

				expect(result).toEqual({
					ok: false,
					missing: ["toolCalling"],
					degradations: [],
				});
			});
		});

		describe("honoursAbortSignal", () => {
			it("should fail when abort signal support is required but unsupported, even with fallbacks enabled", () => {
				const caps = makeCapabilities({ honoursAbortSignal: false });

				const result = checkCapabilities(
					caps,
					{ honoursAbortSignal: true },
					allFallbacks,
				);

				expect(result).toEqual({
					ok: false,
					missing: ["honoursAbortSignal"],
					degradations: [],
				});
			});
		});

		describe("structuredOutput", () => {
			it("should satisfy json_mode requirement when provider supports json_mode", () => {
				const caps = makeCapabilities({ structuredOutput: "json_mode" });

				const result = checkCapabilities(
					caps,
					{ structuredOutput: "json_mode" },
					noFallbacks,
				);

				expect(result).toEqual({
					ok: true,
					degradations: [],
				});
			});

			it("should satisfy json_mode requirement when provider supports json_schema", () => {
				const caps = makeCapabilities({ structuredOutput: "json_schema" });

				const result = checkCapabilities(
					caps,
					{ structuredOutput: "json_mode" },
					noFallbacks,
				);

				expect(result).toEqual({
					ok: true,
					degradations: [],
				});
			});

			it("should fail when json_schema is required, provider only supports json_mode, and fallback is disallowed", () => {
				const caps = makeCapabilities({ structuredOutput: "json_mode" });

				const result = checkCapabilities(
					caps,
					{ structuredOutput: "json_schema" },
					noFallbacks,
				);

				expect(result).toEqual({
					ok: false,
					missing: ["structuredOutput"],
					degradations: [],
				});
			});

			it("should degrade to prompt_validated when json_schema is required, provider only supports json_mode, and fallback is allowed", () => {
				const caps = makeCapabilities({ structuredOutput: "json_mode" });

				const result = checkCapabilities(
					caps,
					{ structuredOutput: "json_schema" },
					{
						allowStructuredOutputFallback: true,
						allowStreamingFallback: false,
					},
				);

				expect(result).toEqual({
					ok: true,
					degradations: ["structured_output:prompt_validated"],
				});
			});

			it.each(["json_mode", "json_schema"] as const)(
				"should fail when %s is required, provider has none, and fallback is disallowed",
				(requiredMode) => {
					const caps = makeCapabilities({ structuredOutput: "none" });

					const result = checkCapabilities(
						caps,
						{ structuredOutput: requiredMode },
						noFallbacks,
					);

					expect(result).toEqual({
						ok: false,
						missing: ["structuredOutput"],
						degradations: [],
					});
				},
			);

			it.each(["json_mode", "json_schema"] as const)(
				"should degrade to prompt_validated when %s is required, provider has none, and fallback is allowed",
				(requiredMode) => {
					const caps = makeCapabilities({ structuredOutput: "none" });

					const result = checkCapabilities(
						caps,
						{ structuredOutput: requiredMode },
						{
							allowStructuredOutputFallback: true,
							allowStreamingFallback: false,
						},
					);

					expect(result).toEqual({
						ok: true,
						degradations: ["structured_output:prompt_validated"],
					});
				},
			);
		});

		describe("streaming", () => {
			it("should fail when streaming is required, unsupported, and fallback is disallowed", () => {
				const caps = makeCapabilities({ streaming: false });

				const result = checkCapabilities(caps, { streaming: true }, noFallbacks);

				expect(result).toEqual({
					ok: false,
					missing: ["streaming"],
					degradations: [],
				});
			});

			it("should degrade to streaming:disabled when streaming is required, unsupported, and fallback is allowed", () => {
				const caps = makeCapabilities({ streaming: false });

				const result = checkCapabilities(
					caps,
					{ streaming: true },
					{
						allowStructuredOutputFallback: false,
						allowStreamingFallback: true,
					},
				);

				expect(result).toEqual({
					ok: true,
					degradations: ["streaming:disabled"],
				});
			});
		});

		describe("combined requirements", () => {
			it("should collect all missing capabilities when none are supported and fallbacks are disallowed", () => {
				const caps = makeCapabilities({
					toolCalling: "none",
					honoursAbortSignal: false,
					structuredOutput: "none",
					streaming: false,
				});
				const req: CapabilityRequirements = {
					toolCalling: "native",
					honoursAbortSignal: true,
					structuredOutput: "json_schema",
					streaming: true,
				};

				const result = checkCapabilities(caps, req, noFallbacks);

				expect(result).toEqual({
					ok: false,
					missing: [
						"toolCalling",
						"honoursAbortSignal",
						"structuredOutput",
						"streaming",
					],
					degradations: [],
				});
			});

			it("should collect all degradations when both structuredOutput and streaming fall back", () => {
				const caps = makeCapabilities({
					structuredOutput: "none",
					streaming: false,
				});
				const req: CapabilityRequirements = {
					structuredOutput: "json_schema",
					streaming: true,
				};

				const result = checkCapabilities(caps, req, allFallbacks);

				expect(result).toEqual({
					ok: true,
					degradations: [
						"structured_output:prompt_validated",
						"streaming:disabled",
					],
				});
			});

			it("should preserve degradations alongside missing capabilities when check fails", () => {
				const caps = makeCapabilities({
					toolCalling: "none",
					honoursAbortSignal: false,
					structuredOutput: "none",
					streaming: false,
				});
				const req: CapabilityRequirements = {
					toolCalling: "native",
					honoursAbortSignal: true,
					structuredOutput: "json_mode",
					streaming: true,
				};

				const result = checkCapabilities(caps, req, allFallbacks);

				expect(result).toEqual({
					ok: false,
					missing: ["toolCalling", "honoursAbortSignal"],
					degradations: [
						"structured_output:prompt_validated",
						"streaming:disabled",
					],
				});
			});
		});
	});
});
