import { randomUUID } from "crypto";
import {
	AgentMessage,
	IToolFailure,
	LLMProviderError,
	ToolDefinition,
} from "../../../types/agent-contracts";
import type {
	ILLMProvider,
	LLMAssistantOutput,
	LLMToolRequest,
} from "../../../types/agent-dependencies";
import type {
	IOllamaChatMessage,
	IOllamaChatRequest,
	IOllamaChatResponse,
	IOllamaToolCall,
	IOllamaToolDefinition,
} from "./ollama.types";
import {
	HttpClientError,
	IHttpStatusError,
	jsonBody,
	post,
} from "../../../core/http";

/** Local models can be slow, especially on first load. */
const DEFAULT_OLLAMA_TIMEOUT_MS = 60_000;

export interface OllamaProviderOptions {
	readonly baseUrl: string;
	readonly model: string;
	readonly timeoutMs?: number;
	readonly fetch?: typeof fetch;
}

export class OllamaProvider implements ILLMProvider {
	private readonly chatUrl: string;
	private readonly model: string;
	private readonly timeoutMs: number;
	private readonly fetchFn?: typeof fetch;

	constructor(options: OllamaProviderOptions) {
		this.chatUrl = `${options.baseUrl.replace(/\/+$/, "")}/api/chat`;
		this.model = options.model;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
		this.fetchFn = options.fetch;
	}

	async generateResponse(
		messages: readonly AgentMessage[],
		tools: readonly ToolDefinition[],
		signal?: AbortSignal,
	): Promise<LLMAssistantOutput> {
		let ollamaMessages: IOllamaChatMessage[];
		try {
			ollamaMessages = messages.map(toOllamaMessage);
		} catch (cause) {
			throw new LLMProviderError(
				"invalid_request",
				"Could not prepare messages",
				{
					cause,
				},
			);
		}

		const body: IOllamaChatRequest = {
			model: this.model,
			messages: ollamaMessages,
			stream: false,
			...(tools.length > 0 ? { tools: tools.map(toOllamaTool) } : {}),
		};

		const result = await post<IOllamaChatResponse>(
			this.chatUrl,
			jsonBody(body),
			{
				signal,
				timeoutMs: this.timeoutMs,
				fetch: this.fetchFn,
				parse: parseOllamaChatResponse,
			},
		);

		if (result.ok === false) {
			throw toProviderError(result.error);
		}

		const { message } = result.data;
		return {
			role: "assistant",
			content: message.content ?? "",
			toolCalls: toToolRequests(message.tool_calls),
		};
	}
}

// --- error mapping ---
function toProviderError(error: HttpClientError): LLMProviderError {
	switch (error.kind) {
		case "timeout":
			return new LLMProviderError(
				"timeout",
				`Ollama did not respond within ${error.timeoutMs} ms`,
			);

		case "aborted":
			return new LLMProviderError("aborted", "Request aborted");

		case "network":
			return new LLMProviderError("network", "Could not reach Ollama", {
				cause: error.cause,
			});

		case "parse":
			return new LLMProviderError("invalid_response", error.message);

		case "request":
			return new LLMProviderError("unknown", "Could not build request");

		case "http":
			return httpStatusToError(error);
	}
}

function httpStatusToError(error: IHttpStatusError): LLMProviderError {
	const detail =
		isRecord(error.body) && typeof error.body.error === "string"
			? `: ${error.body.error}`
			: "";
	const message = `Ollama returned ${error.status}${detail}`;

	if (error.status === 429) {
		return new LLMProviderError("rate_limit", message);
	}
	if (error.status >= 500) {
		return new LLMProviderError("server", message);
	}
	if (error.status === 404) {
		return new LLMProviderError("model_not_found", message);
	}
	return new LLMProviderError("api", message);
}

// --- pure mapping functions (no network) ---

function toOllamaMessage(msg: AgentMessage): IOllamaChatMessage {
	switch (msg.role) {
		case "system":
		case "user":
			return { role: msg.role, content: msg.content };

		case "assistant":
			return {
				role: "assistant",
				content: msg.content,
				...(msg.toolCalls?.length
					? {
							tool_calls: msg.toolCalls.map(
								(c): IOllamaToolCall => ({
									function: { name: c.toolName, arguments: c.arguments },
								}),
							),
						}
					: {}),
			};

		case "tool": {
			const r = msg.toolResult;
			const payload = r.success
				? r.data
				: { error: (r as IToolFailure).error.message };
			return { role: "tool", content: JSON.stringify(payload ?? null) };
		}
	}
}

function toOllamaTool(tool: ToolDefinition): IOllamaToolDefinition {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	};
}

function toToolRequests(
	calls: IOllamaToolCall[] | undefined,
): LLMToolRequest[] | undefined {
	if (!calls?.length) {
		return undefined;
	}
	return calls.map((call) => ({
		id: randomUUID(),
		toolName: call.function.name,
		arguments: call.function.arguments,
	}));
}

// --- response validation (runs inside the client's parse hook) ---
export function parseOllamaChatResponse(data: unknown): IOllamaChatResponse {
	if (!isRecord(data)) {
		fail("body must be an object");
	}

	if (typeof data.model !== "string" || data.model.trim() === "") {
		fail("model must be a non-empty string");
	}

	if (typeof data.done !== "boolean") {
		fail("done must be a boolean");
	}
	if (data.done !== true) {
		fail("done must be true for a non-streaming response");
	}

	const message = data.message;
	if (!isRecord(message)) {
		fail("message must be an object");
	}

	if (message.role !== "assistant") {
		fail(`message.role must be "assistant"`);
	}

	if (typeof message.content !== "string") {
		fail("message.content must be a string");
	}

	if (message.tool_calls !== undefined) {
		if (!Array.isArray(message.tool_calls)) {
			fail("message.tool_calls must be an array when present");
		}
		message.tool_calls.forEach((call, i) => validateToolCall(call, i));
	}

	return data as unknown as IOllamaChatResponse;
}

function validateToolCall(call: unknown, index: number): void {
	const where = `message.tool_calls[${index}]`;

	if (!isRecord(call)) {
		fail(`${where} must be an object`);
	}

	const fn = call.function;
	if (!isRecord(fn)) {
		fail(`${where}.function must be an object`);
	}

	if (typeof fn.name !== "string" || fn.name.trim() === "") {
		fail(`${where}.function.name must be a non-empty string`);
	}

	if (!isRecord(fn.arguments)) {
		fail(`${where}.function.arguments must be an object`);
	}
}

/**
 * Thrown inside the parse hook. The client turns it into kind "parse",
 * which toProviderError maps to "invalid_response" exactly once.
 */
function fail(message: string): never {
	throw new Error(`Ollama response invalid: ${message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function serializeToolPayload(payload: unknown): string {
	try {
		return JSON.stringify(payload ?? null);
	} catch (cause) {
		throw new LLMProviderError(
			"invalid_request",
			"Tool result could not be serialized for the model",
			{ cause },
		);
	}
}
