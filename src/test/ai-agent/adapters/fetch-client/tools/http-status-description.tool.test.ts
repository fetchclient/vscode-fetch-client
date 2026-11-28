import { describe, it, expect } from "vitest";
import { httpStatusDescriptionTool } from "../../../../../fetch-client-ai-agent/adapters/fetch-client/tools/http-status-description.tool";
import { RegistryToolExecutor } from "../../../../../fetch-client-ai-agent/core/tool-executor";
import type { IToolContext } from "../../../../../fetch-client-ai-agent/types/agent-contracts";
import type {
	ApprovedToolCall,
	IToolRegistry,
} from "../../../../../fetch-client-ai-agent/types/agent-dependencies";

function makeContext(toolCallId = "call-1"): IToolContext {
	return { taskId: "task-1", toolCallId };
}

function makeRegistry(): IToolRegistry {
	return {
		lookup: (name) =>
			name === httpStatusDescriptionTool.definition.name
				? httpStatusDescriptionTool
				: undefined,
		definitions: () => [httpStatusDescriptionTool.definition],
	};
}

function approvedCall(
	args: Record<string, unknown>,
	id = "call-1",
): ApprovedToolCall {
	return {
		id,
		idSource: "runtime",
		toolName: httpStatusDescriptionTool.definition.name,
		arguments: args,
		status: "approved",
		requiresApproval: false,
	} as ApprovedToolCall;
}

describe("httpStatusDescriptionTool", () => {
	describe("definition metadata", () => {
		it("has riskLevel set to read", () => {
			expect(httpStatusDescriptionTool.definition.riskLevel).toBe("read");
		});

		it("does not define requiresApproval", () => {
			expect(
				"requiresApproval" in httpStatusDescriptionTool.definition,
			).toBe(false);
			expect(
				httpStatusDescriptionTool.definition.requiresApproval,
			).toBeUndefined();
		});
	});

	describe("tool-level execution", () => {
		it.each([
			{ status: 200, expected: "OK: the request succeeded." },
			{ status: 404, expected: "Not Found: the resource does not exist." },
			{
				status: 503,
				expected:
					"Service Unavailable: the server is temporarily unable to respond.",
			},
		])("returns successful result for status $status", async ({ status, expected }) => {
			const result = await httpStatusDescriptionTool.execute(
				{ status },
				makeContext(),
			);

			expect(result).toEqual({
				toolCallId: "call-1",
				success: true,
				data: expected,
			});
		});

		it("returns expected failure result for unsupported status 599", async () => {
			const result = await httpStatusDescriptionTool.execute(
				{ status: 599 },
				makeContext(),
			);

			expect(result).toEqual({
				toolCallId: "call-1",
				success: false,
				error: {
					code: "INVALID_ARGUMENTS",
					message: "No description for status 599.",
					retryable: false,
				},
			});
		});

		it("preserves toolCallId on success and failure", async () => {
			const successResult = await httpStatusDescriptionTool.execute(
				{ status: 200 },
				makeContext("call-success-42"),
			);
			const failureResult = await httpStatusDescriptionTool.execute(
				{ status: 599 },
				makeContext("call-failure-99"),
			);

			expect(successResult.toolCallId).toBe("call-success-42");
			expect(failureResult.toolCallId).toBe("call-failure-99");
		});
	});

	describe("executor-level schema validation", () => {
		const executor = new RegistryToolExecutor(makeRegistry());

		it.each([
			{ label: "status below minimum (99)", args: { status: 99 } },
			{ label: "status above maximum (600)", args: { status: 600 } },
			{ label: "non-integer status (404.5)", args: { status: 404.5 } },
			{ label: "missing status", args: {} },
			{ label: "extra properties", args: { status: 200, extra: true } },
		])("rejects $label", async ({ args }) => {
			const result = await executor.execute(
				approvedCall(args),
				makeContext(),
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.code).toBe("INVALID_ARGUMENTS");
				expect(result.error.retryable).toBe(false);
			}
		});
	});
});
