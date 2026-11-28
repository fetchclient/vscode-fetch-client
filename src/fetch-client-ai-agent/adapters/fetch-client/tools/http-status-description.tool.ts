import type { ITool } from "../../../types/agent-contracts";

const STATUS_DESCRIPTIONS: Record<number, string> = {
	200: "OK: the request succeeded.",
	201: "Created: a new resource was created.",
	400: "Bad Request: the server could not understand the request.",
	401: "Unauthorized: authentication is required.",
	403: "Forbidden: the server refuses to authorise this request.",
	404: "Not Found: the resource does not exist.",
	500: "Internal Server Error: the server failed unexpectedly.",
	503: "Service Unavailable: the server is temporarily unable to respond.",
};

export const httpStatusDescriptionTool: ITool = {
	definition: {
		name: "describe_http_status",
		description:
			"Explains what an HTTP status code means. Use when the user asks about a status code.",
		inputSchema: {
			type: "object",
			properties: {
				status: {
					type: "integer",
					minimum: 100,
					maximum: 599,
					description: "HTTP status code, for example 404",
				},
			},
			required: ["status"],
			additionalProperties: false,
		},
		riskLevel: "read",
	},

	async execute(args, context) {
		const status = args.status;

		if (typeof status !== "number" || !Number.isInteger(status)) {
			return {
				toolCallId: context.toolCallId,
				success: false,
				error: {
					code: "INVALID_ARGUMENTS",
					message: "status must be an integer.",
					retryable: false,
				},
			};
		}

		const text = STATUS_DESCRIPTIONS[status];
		if (text === undefined) {
			return {
				toolCallId: context.toolCallId,
				success: false,
				error: {
					code: "INVALID_ARGUMENTS",
					message: `No description for status ${status}.`,
					retryable: false,
				},
			};
		}

		return { toolCallId: context.toolCallId, success: true, data: text };
	},
};
