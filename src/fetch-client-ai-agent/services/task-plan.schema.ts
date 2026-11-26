import { z } from "zod";

/**
 * Single source of truth for tool names a plan may reference.
 * The prompt and the schema both read from this list.
 * This validates the identifier only. It does not authorise execution.
 */
export const PLANNED_TOOL_NAMES = [
	"validateOpenApi",
	"getCollectionContext",
	"generateRequestProposal",
	"validateGeneratedProposal",
	"previewProposedChanges",
	"applyApprovedChanges",
	"getOperationStatus",
] as const;

export type PlannedToolName = (typeof PLANNED_TOOL_NAMES)[number];

export const ToolNameSchema = z.enum(PLANNED_TOOL_NAMES);

const TaskStepSchema = z
	.object({
		id: z.number().int().positive(),
		description: z.string().min(1),
		toolName: ToolNameSchema.optional(),
		riskLevel: z.enum(["read", "write", "destructive"]),
	})
	.strict();

export const TaskPlanSchema = z
	.object({
		goal: z.string().min(1),
		steps: z.array(TaskStepSchema).min(1),
	})
	.strict()
	.superRefine((plan, ctx) => {
		const ids = plan.steps.map((step) => step.id);

		if (new Set(ids).size !== ids.length) {
			ctx.addIssue({
				code: "custom",
				path: ["steps"],
				message: "Step IDs must be unique",
			});
		}

		plan.steps.forEach((step, index) => {
			if (step.id !== index + 1) {
				ctx.addIssue({
					code: "custom",
					path: ["steps", index, "id"],
					message: "Step IDs must be sequential, starting at 1",
				});
			}
		});
	});
