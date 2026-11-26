import { describe, it, expect, beforeEach } from "vitest";
import {
	buildTaskPlanPrompt,
	extractJson,
	planTask,
	TASK_PLAN_PROMPT_VERSION,
} from "../../../fetch-client-ai-agent/services/task-planner";
import { PLANNED_TOOL_NAMES } from "../../../fetch-client-ai-agent/services/task-plan.schema";
import { FakeProvider } from "../test-doubles/fake-provider";

describe("task-planner", () => {
	describe("TASK_PLAN_PROMPT_VERSION", () => {
		it("should be defined as expected version", () => {
			expect(TASK_PLAN_PROMPT_VERSION).toBe("task-plan-v1");
		});
	});

	describe("buildTaskPlanPrompt", () => {
		it("should include trimmed goal serialized as JSON", () => {
			const prompt = buildTaskPlanPrompt("  Import OpenAPI and generate tests  ");
			expect(prompt).toContain('"Import OpenAPI and generate tests"');
		});

		it("should safely escape special characters and quotes in goal", () => {
			const rawGoal = 'Goal with "quotes" and \n newlines and \\ backslashes';
			const prompt = buildTaskPlanPrompt(rawGoal);
			expect(prompt).toContain(JSON.stringify(rawGoal.trim()));
		});

		it("should include all planned tool names in tools list", () => {
			const prompt = buildTaskPlanPrompt("Test goal");
			for (const toolName of PLANNED_TOOL_NAMES) {
				expect(prompt).toContain(toolName);
			}
		});

		it("should include core output rules and schema requirements", () => {
			const prompt = buildTaskPlanPrompt("Test goal");
			expect(prompt).toContain('Top-level keys: "goal" (string) and "steps" (array with at least one item)');
			expect(prompt).toContain('"read", "write", or "destructive"');
			expect(prompt).toContain("sequential integer, starting at 1");
		});
	});

	describe("extractJson", () => {
		it("should extract a direct JSON object", () => {
			const raw = '{"goal":"Test","steps":[]}';
			const result = extractJson(raw);
			expect(result).toEqual({ value: { goal: "Test", steps: [] } });
		});

		it("should extract JSON wrapped in ```json code fence", () => {
			const raw = '```json\n{"goal":"Test","steps":[{"id":1}]}\n```';
			const result = extractJson(raw);
			expect(result).toEqual({ value: { goal: "Test", steps: [{ id: 1 }] } });
		});

		it("should extract JSON wrapped in generic ``` code fence", () => {
			const raw = '```\n{"goal":"Test"}\n```';
			const result = extractJson(raw);
			expect(result).toEqual({ value: { goal: "Test" } });
		});

		it("should extract JSON with surrounding conversational text", () => {
			const raw = 'Sure! Here is your plan:\n{"goal":"Generate requests","steps":[]}\nLet me know if you need changes.';
			const result = extractJson(raw);
			expect(result).toEqual({ value: { goal: "Generate requests", steps: [] } });
		});

		it("should extract JSON with surrounding text inside a code fence", () => {
			const raw = '```json\nNote: {"goal":"Inside fence","steps":[]} end\n```';
			const result = extractJson(raw);
			expect(result).toEqual({ value: { goal: "Inside fence", steps: [] } });
		});

		it("should return null if no JSON object braces exist", () => {
			expect(extractJson("Hello world, no json here")).toBeNull();
		});

		it("should return null if closing brace comes before opening brace", () => {
			expect(extractJson("} invalid {")).toBeNull();
		});

		it("should return null if only opening brace exists", () => {
			expect(extractJson("Hello { unfinished")).toBeNull();
		});

		it("should return null if string between braces is not valid JSON", () => {
			expect(extractJson("{ not: valid: json }")).toBeNull();
			expect(extractJson("{'singleQuotes': true}")).toBeNull();
			expect(extractJson('{"trailingComma": 1,}')).toBeNull();
		});
	});

	describe("planTask", () => {
		let provider: FakeProvider;

		beforeEach(() => {
			provider = new FakeProvider();
		});

		const validPlanJson = JSON.stringify({
			goal: "Import OpenAPI and create tests",
			steps: [
				{
					id: 1,
					description: "Check that the OpenAPI file is valid.",
					toolName: "validateOpenApi",
					riskLevel: "read",
				},
				{
					id: 2,
					description: "Apply changes to collection.",
					toolName: "applyApprovedChanges",
					riskLevel: "write",
				},
			],
		});

		it("should succeed on first attempt with clean JSON output", async () => {
			provider.enqueueTextResponse(validPlanJson);

			const result = await planTask("Import OpenAPI and create tests", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.attempts).toBe(1);
				expect(result.plan.goal).toBe("Import OpenAPI and create tests");
				expect(result.plan.steps).toHaveLength(2);
				expect(result.plan.steps[0]).toEqual({
					id: 1,
					description: "Check that the OpenAPI file is valid.",
					toolName: "validateOpenApi",
					riskLevel: "read",
				});
				expect(result.plan.steps[1]).toEqual({
					id: 2,
					description: "Apply changes to collection.",
					toolName: "applyApprovedChanges",
					riskLevel: "write",
				});
			}

			expect(provider.calls).toHaveLength(1);
			expect(provider.calls[0].tools).toEqual([]);
			expect(provider.calls[0].messages).toHaveLength(1);
			expect(provider.calls[0].messages[0].role).toBe("user");
			expect(provider.calls[0].messages[0].content).toContain('"Import OpenAPI and create tests"');
		});

		it("should succeed when valid JSON is wrapped in markdown code fences", async () => {
			provider.enqueueTextResponse(`\`\`\`json\n${validPlanJson}\n\`\`\``);

			const result = await planTask("Import OpenAPI and create tests", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.attempts).toBe(1);
				expect(result.plan.steps).toHaveLength(2);
			}
		});

		it("should succeed when valid JSON is accompanied by explanatory text", async () => {
			provider.enqueueTextResponse(
				`Here is the plan for your request:\n\n${validPlanJson}\n\nHope this helps!`,
			);

			const result = await planTask("Import OpenAPI and create tests", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.attempts).toBe(1);
			}
		});

		it("should allow optional toolName to be omitted in steps", async () => {
			const planWithoutTool = JSON.stringify({
				goal: "Review documentation",
				steps: [
					{
						id: 1,
						description: "Review existing documentation manually.",
						riskLevel: "read",
					},
				],
			});
			provider.enqueueTextResponse(planWithoutTool);

			const result = await planTask("Review documentation", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.plan.steps[0].toolName).toBeUndefined();
			}
		});

		it("should retry and succeed when first attempt returns invalid JSON", async () => {
			provider
				.enqueueTextResponse("Sorry, I cannot produce JSON right now.")
				.enqueueTextResponse(validPlanJson);

			const result = await planTask("Import OpenAPI", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.attempts).toBe(2);
			}

			expect(provider.calls).toHaveLength(2);
			const retryCallMessages = provider.calls[1].messages;
			expect(retryCallMessages).toHaveLength(3);
			expect(retryCallMessages[0].role).toBe("user");
			expect(retryCallMessages[1].role).toBe("assistant");
			expect(retryCallMessages[1].content).toBe("Sorry, I cannot produce JSON right now.");
			expect(retryCallMessages[2].role).toBe("user");
			expect(retryCallMessages[2].content).toContain(
				"Your previous reply was not a single valid JSON object. Return only the JSON object, with no text or code fences.",
			);
		});

		it("should retry and succeed when first attempt returns invalid plan schema", async () => {
			const invalidSchemaJson = JSON.stringify({
				goal: "Invalid schema plan",
				steps: [
					{
						id: 2, // Non-sequential ID
						description: "Wrong first step ID",
						riskLevel: "read",
					},
				],
			});

			provider
				.enqueueTextResponse(invalidSchemaJson)
				.enqueueTextResponse(validPlanJson);

			const result = await planTask("Invalid schema plan", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.attempts).toBe(2);
			}

			expect(provider.calls).toHaveLength(2);
			const retryCallMessages = provider.calls[1].messages;
			expect(retryCallMessages).toHaveLength(3);
			expect(retryCallMessages[2].role).toBe("user");
			expect(retryCallMessages[2].content).toContain(
				"Your previous JSON did not match the required structure. Fix these problems and return the full corrected JSON object only:",
			);
			expect(retryCallMessages[2].content).toContain("steps.0.id: Step IDs must be sequential, starting at 1");
		});

		it("should return invalid_json error when retries are exhausted", async () => {
			provider
				.enqueueTextResponse("Still not JSON")
				.enqueueTextResponse("Still not valid JSON");

			const result = await planTask("Test goal", provider, { maxRetries: 1 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.attempts).toBe(2);
				expect(result.error.kind).toBe("invalid_json");
			}
			expect(provider.calls).toHaveLength(2);
		});

		it("should return invalid_plan error with issues when retries are exhausted", async () => {
			const invalidStepPlan = JSON.stringify({
				goal: "Bad plan",
				steps: [
					{
						id: 1,
						description: "Step with invalid risk level",
						riskLevel: "unknown_risk",
					},
				],
			});

			provider
				.enqueueTextResponse(invalidStepPlan)
				.enqueueTextResponse(invalidStepPlan);

			const result = await planTask("Bad plan", provider, { maxRetries: 1 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.attempts).toBe(2);
				expect(result.error.kind).toBe("invalid_plan");
				if (result.error.kind === "invalid_plan") {
					expect(result.error.issues.length).toBeGreaterThan(0);
					expect(result.error.issues[0]).toContain("steps.0.riskLevel");
				}
			}
		});

		it("should respect maxRetries: 0 and fail after first attempt", async () => {
			provider.enqueueTextResponse("Not JSON");

			const result = await planTask("Test goal", provider, { maxRetries: 0 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.attempts).toBe(1);
				expect(result.error.kind).toBe("invalid_json");
			}
			expect(provider.calls).toHaveLength(1);
		});

		it("should respect custom maxRetries > 1 and succeed on 3rd attempt", async () => {
			provider
				.enqueueTextResponse("Invalid 1")
				.enqueueTextResponse("Invalid 2")
				.enqueueTextResponse(validPlanJson);

			const result = await planTask("Test goal", provider, { maxRetries: 2 });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.attempts).toBe(3);
			}
			expect(provider.calls).toHaveLength(3);
		});

		it("should forward AbortSignal to provider", async () => {
			const controller = new AbortController();
			provider.enqueueTextResponse(validPlanJson);

			await planTask("Test goal", provider, { signal: controller.signal });

			expect(provider.calls).toHaveLength(1);
			expect(provider.calls[0].signal).toBe(controller.signal);
		});

		it("should propagate provider exceptions without catching them", async () => {
			const controller = new AbortController();
			controller.abort();

			await expect(
				planTask("Test goal", provider, { signal: controller.signal }),
			).rejects.toThrow("Aborted");
		});

		it("should propagate network or API errors thrown by provider", async () => {
			provider.setResponder(() => {
				throw new Error("503 Service Unavailable");
			});

			await expect(planTask("Test goal", provider)).rejects.toThrow(
				"503 Service Unavailable",
			);
		});

		it("should fail validation on unknown toolName", async () => {
			const unknownToolPlan = JSON.stringify({
				goal: "Test unknown tool",
				steps: [
					{
						id: 1,
						description: "Call an unknown tool",
						toolName: "nonExistentTool",
						riskLevel: "read",
					},
				],
			});

			provider.enqueueTextResponse(unknownToolPlan);

			const result = await planTask("Test unknown tool", provider, { maxRetries: 0 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_plan");
				if (result.error.kind === "invalid_plan") {
					expect(result.error.issues.some((i) => i.includes("steps.0.toolName"))).toBe(true);
				}
			}
		});

		it("should fail validation when steps are empty", async () => {
			const emptyStepsPlan = JSON.stringify({
				goal: "Empty steps plan",
				steps: [],
			});

			provider.enqueueTextResponse(emptyStepsPlan);

			const result = await planTask("Empty steps plan", provider, { maxRetries: 0 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_plan");
				if (result.error.kind === "invalid_plan") {
					expect(result.error.issues.some((i) => i.includes("steps"))).toBe(true);
				}
			}
		});

		it("should fail validation when extra unexpected fields exist on top level", async () => {
			const extraFieldPlan = JSON.stringify({
				goal: "Extra field plan",
				steps: [
					{
						id: 1,
						description: "Normal step",
						riskLevel: "read",
					},
				],
				extraField: "not allowed",
			});

			provider.enqueueTextResponse(extraFieldPlan);

			const result = await planTask("Extra field plan", provider, { maxRetries: 0 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_plan");
				if (result.error.kind === "invalid_plan") {
					expect(result.error.issues.some((i) => i.includes("extraField"))).toBe(true);
				}
			}
		});
	});
});
