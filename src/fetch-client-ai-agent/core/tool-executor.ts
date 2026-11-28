import Ajv, { type ValidateFunction } from "ajv";
import type {
	ITool,
	IToolContext,
	ToolErrorCode,
	ToolResult,
} from "../types/agent-contracts";
import type {
	ApprovedToolCall,
	IToolExecutor,
	IToolRegistry,
} from "../types/agent-dependencies";

function failure(
	toolCallId: string,
	code: ToolErrorCode,
	message: string,
): ToolResult {
	return {
		toolCallId,
		success: false,
		error: { code, message, retryable: false },
	};
}

export class RegistryToolExecutor implements IToolExecutor {
	private readonly ajv = new Ajv({ allErrors: false });
	private readonly validators = new WeakMap<ITool, ValidateFunction>();

	constructor(private readonly registry: IToolRegistry) {}

	async execute(
		call: ApprovedToolCall,
		context: IToolContext,
	): Promise<ToolResult> {
		const tool = this.registry.lookup(call.toolName);
		if (!tool) {
			return failure(call.id, "UNKNOWN_TOOL", `Unknown tool: ${call.toolName}`);
		}

		let validate: ValidateFunction;
		try {
			validate = this.validatorFor(tool);
		} catch {
			// Schema failed to compile: a broken tool definition, not a model error.
			return failure(
				call.id,
				"TOOL_EXECUTION_FAILED",
				"The tool definition is invalid.",
			);
		}

		if (!validate(call.arguments)) {
			return failure(
				call.id,
				"INVALID_ARGUMENTS",
				"Tool arguments do not match the schema.",
			);
		}

		// The executor owns the id, so the tool always answers this call.
		const callContext: IToolContext = { ...context, toolCallId: call.id };

		try {
			return await tool.execute(call.arguments, callContext);
		} catch {
			// Raw exception text is never logged or returned (see architecture notes).
			return failure(
				call.id,
				"TOOL_EXECUTION_FAILED",
				"The tool failed unexpectedly.",
			);
		}
	}

	private validatorFor(tool: ITool): ValidateFunction {
		let validate = this.validators.get(tool);
		if (!validate) {
			validate = this.ajv.compile(tool.definition.inputSchema);
			this.validators.set(tool, validate);
		}
		return validate;
	}
}
