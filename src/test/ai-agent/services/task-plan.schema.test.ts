import { describe, it, expect } from "vitest";
import {
	PLANNED_TOOL_NAMES,
	ToolNameSchema,
	TaskPlanSchema,
} from "../../../fetch-client-ai-agent/services/task-plan.schema";

describe("task-plan.schema", () => {
	describe("PLANNED_TOOL_NAMES", () => {
		it("should contain the 7 defined tool names in expected order", () => {
			expect(PLANNED_TOOL_NAMES).toEqual([
				"validateOpenApi",
				"getCollectionContext",
				"generateRequestProposal",
				"validateGeneratedProposal",
				"previewProposedChanges",
				"applyApprovedChanges",
				"getOperationStatus",
			]);
		});

		it("should have no duplicate tool names", () => {
			const set = new Set(PLANNED_TOOL_NAMES);
			expect(set.size).toBe(PLANNED_TOOL_NAMES.length);
		});
	});

	describe("ToolNameSchema", () => {
		it.each(PLANNED_TOOL_NAMES)(
			"should successfully parse valid toolName: %s",
			(name) => {
				const result = ToolNameSchema.safeParse(name);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data).toBe(name);
				}
			},
		);

		it("should reject unknown tool names", () => {
			const invalidNames = [
				"deleteEverything",
				"unknownTool",
				"validateopenapi",
				"VALIDATEOPENAPI",
				"",
			];

			for (const name of invalidNames) {
				const result = ToolNameSchema.safeParse(name);
				expect(result.success).toBe(false);
			}
		});

		it("should reject non-string types", () => {
			const nonStrings = [null, undefined, 123, true, {}, []];

			for (const val of nonStrings) {
				const result = ToolNameSchema.safeParse(val);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("TaskPlanSchema", () => {
		const validBasePlan = {
			goal: "Import OpenAPI and generate test suite",
			steps: [
				{
					id: 1,
					description: "Validate the OpenAPI document",
					toolName: "validateOpenApi",
					riskLevel: "read",
				},
				{
					id: 2,
					description: "Inspect collection context",
					toolName: "getCollectionContext",
					riskLevel: "read",
				},
				{
					id: 3,
					description: "Apply approved changes to workspace",
					toolName: "applyApprovedChanges",
					riskLevel: "write",
				},
			],
		};

		describe("valid plans", () => {
			it("should parse a valid multi-step plan", () => {
				const result = TaskPlanSchema.safeParse(validBasePlan);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data).toEqual(validBasePlan);
				}
			});

			it("should parse a valid single-step plan", () => {
				const plan = {
					goal: "Quick inspection",
					steps: [
						{
							id: 1,
							description: "Check operation status",
							toolName: "getOperationStatus",
							riskLevel: "read",
						},
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(true);
			});

			it("should parse a step with optional toolName omitted", () => {
				const plan = {
					goal: "Manual review step",
					steps: [
						{
							id: 1,
							description: "User manually reviews OpenAPI spec in editor",
							riskLevel: "read",
						},
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.steps[0].toolName).toBeUndefined();
				}
			});

			it("should allow all valid risk levels: read, write, destructive", () => {
				const plan = {
					goal: "Plan exercising each risk level",
					steps: [
						{ id: 1, description: "Read action", riskLevel: "read" },
						{ id: 2, description: "Write action", riskLevel: "write" },
						{
							id: 3,
							description: "Destructive action",
							riskLevel: "destructive",
						},
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(true);
			});
		});

		describe("top-level constraints", () => {
			it("should reject non-object values", () => {
				const nonObjects = [null, undefined, "plan", 123, true, []];

				for (const val of nonObjects) {
					const result = TaskPlanSchema.safeParse(val);
					expect(result.success).toBe(false);
				}
			});

			it("should reject missing or empty goal", () => {
				const missingGoal = {
					steps: [{ id: 1, description: "Do task", riskLevel: "read" }],
				};
				const emptyGoal = {
					goal: "",
					steps: [{ id: 1, description: "Do task", riskLevel: "read" }],
				};

				expect(TaskPlanSchema.safeParse(missingGoal).success).toBe(false);
				expect(TaskPlanSchema.safeParse(emptyGoal).success).toBe(false);
			});

			it("should reject non-string goal", () => {
				const plan = {
					goal: 12345,
					steps: [{ id: 1, description: "Do task", riskLevel: "read" }],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
			});

			it("should reject missing, empty, or non-array steps", () => {
				const missingSteps = { goal: "My Goal" };
				const emptySteps = { goal: "My Goal", steps: [] };
				const nonArraySteps = { goal: "My Goal", steps: "not-an-array" };

				expect(TaskPlanSchema.safeParse(missingSteps).success).toBe(false);
				expect(TaskPlanSchema.safeParse(emptySteps).success).toBe(false);
				expect(TaskPlanSchema.safeParse(nonArraySteps).success).toBe(false);
			});

			it("should reject unexpected top-level properties (strict schema)", () => {
				const planWithExtra = {
					...validBasePlan,
					extraNotes: "This should not be allowed",
				};

				const result = TaskPlanSchema.safeParse(planWithExtra);
				expect(result.success).toBe(false);
			});
		});

		describe("step-level constraints", () => {
			it("should reject unexpected properties on step (strict step schema)", () => {
				const plan = {
					goal: "Extra field on step",
					steps: [
						{
							id: 1,
							description: "Valid description",
							riskLevel: "read",
							extraField: "not-allowed",
						},
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
			});

			it("should reject step with missing or non-integer id", () => {
				const missingId = {
					goal: "Test",
					steps: [{ description: "No id", riskLevel: "read" }],
				};
				const floatId = {
					goal: "Test",
					steps: [{ id: 1.5, description: "Float id", riskLevel: "read" }],
				};
				const stringId = {
					goal: "Test",
					steps: [{ id: "1", description: "String id", riskLevel: "read" }],
				};

				expect(TaskPlanSchema.safeParse(missingId).success).toBe(false);
				expect(TaskPlanSchema.safeParse(floatId).success).toBe(false);
				expect(TaskPlanSchema.safeParse(stringId).success).toBe(false);
			});

			it("should reject step with zero or negative id", () => {
				const zeroId = {
					goal: "Test",
					steps: [{ id: 0, description: "Zero id", riskLevel: "read" }],
				};
				const negativeId = {
					goal: "Test",
					steps: [{ id: -1, description: "Negative id", riskLevel: "read" }],
				};

				expect(TaskPlanSchema.safeParse(zeroId).success).toBe(false);
				expect(TaskPlanSchema.safeParse(negativeId).success).toBe(false);
			});

			it("should reject step with missing or empty description", () => {
				const missingDescription = {
					goal: "Test",
					steps: [{ id: 1, riskLevel: "read" }],
				};
				const emptyDescription = {
					goal: "Test",
					steps: [{ id: 1, description: "", riskLevel: "read" }],
				};

				expect(TaskPlanSchema.safeParse(missingDescription).success).toBe(
					false,
				);
				expect(TaskPlanSchema.safeParse(emptyDescription).success).toBe(false);
			});

			it("should reject step with invalid riskLevel", () => {
				const invalidRiskLevels = [
					"low",
					"high",
					"safe",
					"READ",
					"WRITE",
					"",
					123,
				];

				for (const level of invalidRiskLevels) {
					const plan = {
						goal: "Test",
						steps: [{ id: 1, description: "Task", riskLevel: level }],
					};
					const result = TaskPlanSchema.safeParse(plan);
					expect(result.success).toBe(false);
				}
			});

			it("should reject step with invalid toolName", () => {
				const plan = {
					goal: "Test",
					steps: [
						{
							id: 1,
							description: "Task",
							riskLevel: "read",
							toolName: "deleteEverything",
						},
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
			});
		});

		describe("superRefine step ordering and uniqueness rules", () => {
			it("should reject step IDs that do not start at 1", () => {
				const plan = {
					goal: "Starting at 2",
					steps: [
						{ id: 2, description: "Step 1", riskLevel: "read" },
						{ id: 3, description: "Step 2", riskLevel: "read" },
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
				if (!result.success) {
					const sequentialIssue = result.error.issues.find(
						(i) => i.message === "Step IDs must be sequential, starting at 1",
					);
					expect(sequentialIssue).toBeDefined();
					expect(sequentialIssue?.path).toEqual(["steps", 0, "id"]);
				}
			});

			it("should reject non-sequential step IDs with gaps (e.g. 1, 3)", () => {
				const plan = {
					goal: "Skipped step id",
					steps: [
						{ id: 1, description: "Step 1", riskLevel: "read" },
						{ id: 3, description: "Step 3", riskLevel: "read" },
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
				if (!result.success) {
					const issue = result.error.issues.find(
						(i) => i.message === "Step IDs must be sequential, starting at 1",
					);
					expect(issue).toBeDefined();
					expect(issue?.path).toEqual(["steps", 1, "id"]);
				}
			});

			it("should reject out-of-order step IDs (e.g. 2, 1)", () => {
				const plan = {
					goal: "Out of order IDs",
					steps: [
						{ id: 2, description: "Step 2 first", riskLevel: "read" },
						{ id: 1, description: "Step 1 second", riskLevel: "read" },
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
				if (!result.success) {
					const issue = result.error.issues.find(
						(i) => i.message === "Step IDs must be sequential, starting at 1",
					);
					expect(issue).toBeDefined();
				}
			});

			it("should reject duplicate step IDs", () => {
				const plan = {
					goal: "Duplicate IDs",
					steps: [
						{ id: 1, description: "First step", riskLevel: "read" },
						{ id: 1, description: "Duplicate first step", riskLevel: "read" },
					],
				};

				const result = TaskPlanSchema.safeParse(plan);
				expect(result.success).toBe(false);
				if (!result.success) {
					const uniqueIssue = result.error.issues.find(
						(i) => i.message === "Step IDs must be unique",
					);
					expect(uniqueIssue).toBeDefined();
					expect(uniqueIssue?.path).toEqual(["steps"]);
				}
			});
		});
	});
});
