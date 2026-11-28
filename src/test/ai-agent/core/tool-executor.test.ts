import { describe, it, expect, vi } from "vitest";
import { RegistryToolExecutor } from "../../../fetch-client-ai-agent/core/tool-executor";
import { InMemoryToolRegistry } from "../test-doubles/in-memory-registry";
import type { ApprovedToolCall } from "../../../fetch-client-ai-agent/types/agent-dependencies";
import type {
	IJSONSchema,
	ITool,
	IToolContext,
} from "../../../fetch-client-ai-agent/types/agent-contracts";

const ctx: IToolContext = { taskId: "task-1", toolCallId: "ctx-default" };

const echoSchema: IJSONSchema = {
	type: "object",
	properties: { text: { type: "string" } },
	required: ["text"],
	additionalProperties: false,
};

function makeEchoTool(execute: ITool["execute"]): ITool {
	return {
		definition: {
			name: "echo",
			description: "Echo text back",
			inputSchema: echoSchema,
			riskLevel: "read",
		},
		execute,
	};
}

function approvedCall(
	overrides: Partial<{
		id: string;
		toolName: string;
		arguments: Record<string, unknown>;
	}> = {},
): ApprovedToolCall {
	return {
		id: "call-1",
		toolName: "echo",
		arguments: { text: "hi" },
		status: "approved",
		requiresApproval: false,
		...overrides,
	} as ApprovedToolCall; // brand is compile-time only
}

describe("RegistryToolExecutor", () => {
	it("returns success for valid input", async () => {
		const execute = vi.fn<ITool["execute"]>(async (args) => ({
			toolCallId: "call-1",
			success: true,
			data: args,
		}));
		const registry = new InMemoryToolRegistry().register(makeEchoTool(execute));
		const executor = new RegistryToolExecutor(registry);

		const result = await executor.execute(approvedCall(), ctx);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({ text: "hi" });
		}
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("returns INVALID_ARGUMENTS and never runs the tool for invalid input", async () => {
		const execute = vi.fn<ITool["execute"]>(async (args) => ({
			toolCallId: "call-1",
			success: true,
			data: args,
		}));
		const registry = new InMemoryToolRegistry().register(makeEchoTool(execute));
		const executor = new RegistryToolExecutor(registry);

		const result = await executor.execute(
			approvedCall({ arguments: { text: 42 } }),
			ctx,
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.code).toBe("INVALID_ARGUMENTS");
			expect(result.error.retryable).toBe(false);
		}
		expect(execute).not.toHaveBeenCalled();
	});

	it("converts a thrown error into TOOL_EXECUTION_FAILED without leaking details", async () => {
		const execute = vi.fn<ITool["execute"]>(async () => {
			throw new Error("boom at /secret/path");
		});
		const registry = new InMemoryToolRegistry().register(makeEchoTool(execute));
		const executor = new RegistryToolExecutor(registry);

		const result = await executor.execute(approvedCall(), ctx);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.code).toBe("TOOL_EXECUTION_FAILED");
			expect(result.error.message).not.toContain("boom");
			expect(result.error.message).not.toContain("/secret/path");
		}
	});

	it("returns UNKNOWN_TOOL for an unregistered tool name", async () => {
		const executor = new RegistryToolExecutor(new InMemoryToolRegistry());

		const result = await executor.execute(
			approvedCall({ toolName: "missing" }),
			ctx,
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.code).toBe("UNKNOWN_TOOL");
			expect(result.error.retryable).toBe(false);
			expect(result.toolCallId).toBe("call-1");
		}
	});

	it("sets toolCallId on the execution context from call.id and preserves other context fields", async () => {
		const execute = vi.fn<ITool["execute"]>(async (_args, callCtx) => ({
			toolCallId: callCtx.toolCallId,
			success: true,
			data: callCtx,
		}));
		const registry = new InMemoryToolRegistry().register(makeEchoTool(execute));
		const executor = new RegistryToolExecutor(registry);
		const controller = new AbortController();
		const richCtx: IToolContext = {
			taskId: "task-9",
			toolCallId: "stale-id",
			signal: controller.signal,
			workspacePath: "/workspace/project",
		};

		const result = await executor.execute(
			approvedCall({ id: "call-99" }),
			richCtx,
		);

		expect(result.success).toBe(true);
		expect(execute).toHaveBeenCalledWith(
			{ text: "hi" },
			{
				taskId: "task-9",
				toolCallId: "call-99",
				signal: controller.signal,
				workspacePath: "/workspace/project",
			},
		);
	});

	it("returns TOOL_EXECUTION_FAILED when the tool schema fails to compile", async () => {
		const execute = vi.fn<ITool["execute"]>(async () => ({
			toolCallId: "call-1",
			success: true,
			data: {},
		}));
		const brokenTool: ITool = {
			definition: {
				name: "broken",
				description: "Tool with invalid schema",
				inputSchema: {
					type: "object",
					properties: {
						bad: { type: "not-a-json-type" as unknown as "string" },
					},
				},
				riskLevel: "read",
			},
			execute,
		};
		const registry = new InMemoryToolRegistry().register(brokenTool);
		const executor = new RegistryToolExecutor(registry);

		const result = await executor.execute(
			approvedCall({ toolName: "broken", arguments: { bad: "x" } }),
			ctx,
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.toolCallId).toBe("call-1");
			expect(result.error.code).toBe("TOOL_EXECUTION_FAILED");
			expect(result.error.message).toBe("The tool definition is invalid.");
			expect(result.error.retryable).toBe(false);
		}
		expect(execute).not.toHaveBeenCalled();
	});

	it("recompiles the validator when a tool with the same name is replaced", async () => {
		const registry = new InMemoryToolRegistry();
		const executor = new RegistryToolExecutor(registry);

		const firstTool = makeEchoTool(async (args) => ({
			toolCallId: "call-1",
			success: true,
			data: args,
		}));
		registry.register(firstTool);

		const firstResult = await executor.execute(
			approvedCall({ arguments: { text: "hi" } }),
			ctx,
		);
		expect(firstResult.success).toBe(true);

		const replacedTool: ITool = {
			definition: {
				name: "echo",
				description: "Echo count instead",
				inputSchema: {
					type: "object",
					properties: { count: { type: "number" } },
					required: ["count"],
					additionalProperties: false,
				},
				riskLevel: "read",
			},
			execute: async (args) => ({
				toolCallId: "call-2",
				success: true,
				data: args,
			}),
		};
		registry.register(replacedTool);

		const staleArgsResult = await executor.execute(
			approvedCall({ id: "call-2", arguments: { text: "hi" } }),
			ctx,
		);
		expect(staleArgsResult.success).toBe(false);
		if (!staleArgsResult.success) {
			expect(staleArgsResult.error.code).toBe("INVALID_ARGUMENTS");
		}

		const newArgsResult = await executor.execute(
			approvedCall({ id: "call-3", arguments: { count: 3 } }),
			ctx,
		);
		expect(newArgsResult.success).toBe(true);
		if (newArgsResult.success) {
			expect(newArgsResult.data).toEqual({ count: 3 });
		}
	});
});
