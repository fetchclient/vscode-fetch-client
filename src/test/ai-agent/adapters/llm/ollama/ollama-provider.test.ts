import { describe, it, expect, vi } from "vitest";
import {
	OllamaProvider,
	parseOllamaChatResponse,
	OllamaProviderOptions,
} from "../../../../../fetch-client-ai-agent/adapters/llm/ollama/ollama-provider";
import {
	LLMProviderError,
	type AgentMessage,
	type ToolDefinition,
} from "../../../../../fetch-client-ai-agent/types/agent-contracts";

describe("OllamaProvider", () => {
	const defaultOptions: OllamaProviderOptions = {
		baseUrl: "http://localhost:11434",
		model: "llama3.2",
	};

	function createMockResponse(
		body: unknown,
		status = 200,
		statusText = "OK",
	): Response {
		const rawText = typeof body === "string" ? body : JSON.stringify(body);
		return new Response(rawText, {
			status,
			statusText,
			headers: {
				"Content-Type": "application/json",
			},
		});
	}

	describe("constructor", () => {
		it("initializes with provided options and custom fetch", () => {
			const mockFetch = vi.fn();
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});
			expect(provider).toBeDefined();
		});

		it("falls back to global fetch when fetch option is not provided", async () => {
			const globalMock = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: { role: "assistant", content: "ok" },
					done: true,
				}),
			);
			vi.stubGlobal("fetch", globalMock);

			try {
				await new OllamaProvider(defaultOptions).generateResponse([], []);
				expect(globalMock).toHaveBeenCalledTimes(1);
				expect(globalMock.mock.calls[0][0]).toBe(
					"http://localhost:11434/api/chat",
				);
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("accepts custom timeoutMs option", () => {
			const provider = new OllamaProvider({
				...defaultOptions,
				timeoutMs: 30_000,
			});
			expect(provider).toBeDefined();
		});
	});

	describe("generateResponse", () => {
		it("sends chat request and parses assistant text response successfully", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: { role: "assistant", content: "Hello! How can I help you?" },
					done: true,
				}),
			);

			const provider = new OllamaProvider({
				baseUrl: "http://localhost:11434/",
				model: "llama3.2",
				fetch: mockFetch as unknown as typeof fetch,
			});

			const messages: AgentMessage[] = [
				{ id: "msg-1", timestamp: Date.now(), role: "user", content: "Hello" },
			];

			const result = await provider.generateResponse(messages, []);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("http://localhost:11434/api/chat");
			expect(init.method).toBe("POST");

			const headers = new Headers(init.headers);
			expect(headers.get("Content-Type")).toBe("application/json");
			expect(headers.get("Accept")).toBe("application/json");

			const parsedBody = JSON.parse(init.body);
			expect(parsedBody).toEqual({
				model: "llama3.2",
				messages: [{ role: "user", content: "Hello" }],
				stream: false,
			});
			expect(parsedBody.tools).toBeUndefined();

			expect(result).toEqual({
				role: "assistant",
				content: "Hello! How can I help you?",
				toolCalls: undefined,
			});
		});

		it("trims trailing slashes from baseUrl", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: { role: "assistant", content: "Hi" },
					done: true,
				}),
			);

			const provider = new OllamaProvider({
				baseUrl: "http://localhost:11434///",
				model: "llama3.2",
				fetch: mockFetch as unknown as typeof fetch,
			});

			await provider.generateResponse([], []);

			const [url] = mockFetch.mock.calls[0];
			expect(url).toBe("http://localhost:11434/api/chat");
		});

		it("links caller abort to the signal passed to fetch", async () => {
			const controller = new AbortController();
			let forwarded: AbortSignal | undefined;

			const mockFetch = vi.fn().mockImplementation((_url, init) => {
				forwarded = init.signal;
				return new Promise((_, reject) => {
					init.signal.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
					controller.abort();
				});
			});

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(
				provider.generateResponse([], [], controller.signal),
			).rejects.toMatchObject({ kind: "aborted" });
			expect(forwarded?.aborted).toBe(true);
		});

		it("maps all message roles correctly (system, user, assistant, tool)", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: { role: "assistant", content: "All good" },
					done: true,
				}),
			);

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			const messages: AgentMessage[] = [
				{
					id: "1",
					timestamp: 100,
					role: "system",
					content: "You are a helpful assistant",
				},
				{ id: "2", timestamp: 101, role: "user", content: "Call get_user" },
				{
					id: "3",
					timestamp: 102,
					role: "assistant",
					content: "Calling tool...",
					toolCalls: [
						{
							id: "call-1",
							toolName: "get_user",
							arguments: { userId: "42" },
							status: "approved",
							requiresApproval: false,
						},
					],
				},
				{
					id: "4",
					timestamp: 103,
					role: "tool",
					toolResult: {
						toolCallId: "call-1",
						success: true,
						data: { name: "Alice", role: "admin" },
					},
				},
				{
					id: "5",
					timestamp: 104,
					role: "tool",
					toolResult: {
						toolCallId: "call-2",
						success: false,
						error: {
							code: "PERMISSION_DENIED",
							message: "Permission denied",
							retryable: false,
						},
					},
				},
				{
					id: "6",
					timestamp: 105,
					role: "tool",
					toolResult: {
						toolCallId: "call-3",
						success: true,
						data: undefined,
					},
				},
			];

			await provider.generateResponse(messages, []);

			const [, init] = mockFetch.mock.calls[0];
			const parsedBody = JSON.parse(init.body);
			expect(parsedBody.messages).toEqual([
				{ role: "system", content: "You are a helpful assistant" },
				{ role: "user", content: "Call get_user" },
				{
					role: "assistant",
					content: "Calling tool...",
					tool_calls: [
						{
							function: {
								name: "get_user",
								arguments: { userId: "42" },
							},
						},
					],
				},
				{
					role: "tool",
					content: JSON.stringify({ name: "Alice", role: "admin" }),
				},
				{
					role: "tool",
					content: JSON.stringify({ error: "Permission denied" }),
				},
				{
					role: "tool",
					content: "null",
				},
			]);
		});

		it("maps assistant message without tool calls correctly", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: { role: "assistant", content: "I am ready" },
					done: true,
				}),
			);

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			const messages: AgentMessage[] = [
				{ id: "1", timestamp: 100, role: "assistant", content: "I am ready" },
			];

			await provider.generateResponse(messages, []);

			const [, init] = mockFetch.mock.calls[0];
			const parsedBody = JSON.parse(init.body);
			expect(parsedBody.messages[0]).toEqual({
				role: "assistant",
				content: "I am ready",
			});
			expect(parsedBody.messages[0].tool_calls).toBeUndefined();
		});

		it("maps tools definitions correctly when tools are provided", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: {
						role: "assistant",
						content: "",
						tool_calls: [
							{
								function: {
									name: "fetch_data",
									arguments: { endpoint: "/users" },
								},
							},
						],
					},
					done: true,
				}),
			);

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			const tools: ToolDefinition[] = [
				{
					name: "fetch_data",
					description: "Fetches data from an API",
					inputSchema: {
						type: "object",
						properties: {
							endpoint: { type: "string", description: "API endpoint" },
						},
						required: ["endpoint"],
					},
					riskLevel: "read",
				},
			];

			const result = await provider.generateResponse([], tools);

			const [, init] = mockFetch.mock.calls[0];
			const parsedBody = JSON.parse(init.body);
			expect(parsedBody.tools).toEqual([
				{
					type: "function",
					function: {
						name: "fetch_data",
						description: "Fetches data from an API",
						parameters: {
							type: "object",
							properties: {
								endpoint: { type: "string", description: "API endpoint" },
							},
							required: ["endpoint"],
						},
					},
				},
			]);

			expect(result.role).toBe("assistant");
			expect(result.content).toBe("");
			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls?.[0]).toEqual({
				id: expect.any(String),
				toolName: "fetch_data",
				arguments: { endpoint: "/users" },
			});
		});

		it("handles response with tool_calls and empty content", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: {
						role: "assistant",
						content: "",
						tool_calls: [
							{ function: { name: "search", arguments: { q: "vitest" } } },
						],
					},
					done: true,
				}),
			);

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			const result = await provider.generateResponse([], []);
			expect(result.content).toBe("");
			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls?.[0].toolName).toBe("search");
		});

		it("throws LLMProviderError(invalid_request) when preparing messages fails", async () => {
			const circular: Record<string, unknown> = {};
			circular.self = circular;

			const provider = new OllamaProvider(defaultOptions);
			const messages: AgentMessage[] = [
				{
					id: "1",
					timestamp: 100,
					role: "tool",
					toolResult: {
						toolCallId: "call-1",
						success: true,
						data: circular,
					},
				},
			];

			await expect(
				provider.generateResponse(messages, []),
			).rejects.toMatchObject({
				kind: "invalid_request",
				message: "Could not prepare messages",
			});
		});

		it("marks invalid_request as non-retryable", async () => {
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			const provider = new OllamaProvider(defaultOptions);

			await expect(
				provider.generateResponse(
					[
						{
							id: "1",
							timestamp: 100,
							role: "tool",
							toolResult: { toolCallId: "c", success: true, data: circular },
						},
					],
					[],
				),
			).rejects.toMatchObject({ kind: "invalid_request", retryable: false });
		});

		it("maps 404 without a body detail to model_not_found", async () => {
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: vi
					.fn()
					.mockResolvedValue(
						createMockResponse("not found", 404, "Not Found"),
					) as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "model_not_found",
				message: "Ollama returned 404",
				retryable: false,
			});
		});

		it("throws LLMProviderError(timeout) when response body reading times out", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				text: vi.fn().mockImplementation(() => new Promise<string>(() => {})),
			});

			const provider = new OllamaProvider({
				...defaultOptions,
				timeoutMs: 20,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "timeout",
				retryable: true,
			});
		});

		it("throws LLMProviderError(aborted) when caller aborts during response body reading", async () => {
			const controller = new AbortController();

			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				text: vi.fn().mockImplementation(() => new Promise<string>(() => {})),
			});

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			const pending = provider.generateResponse([], [], controller.signal);

			// Allow fetch to resolve and response body reading to begin.
			await vi.waitFor(() => {
				expect(mockFetch).toHaveBeenCalledTimes(1);
			});

			controller.abort();

			await expect(pending).rejects.toMatchObject({
				kind: "aborted",
				retryable: false,
			});
		});

		it("throws LLMProviderError(invalid_response) when response body is empty", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				new Response(null, {
					status: 200,
					statusText: "OK",
				}),
			);

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "invalid_response",
			});
		});
	});

	describe("error handling", () => {
		it("throws LLMProviderError(timeout) when request times out", async () => {
			const mockFetch = vi.fn().mockImplementation((_url, init) => {
				return new Promise((_, reject) => {
					init.signal.addEventListener("abort", () => {
						reject(new DOMException("The operation was aborted", "AbortError"));
					});
				});
			});

			const provider = new OllamaProvider({
				...defaultOptions,
				timeoutMs: 20,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "timeout",
				message: "Ollama did not respond within 20 ms",
			});
		});

		it("throws LLMProviderError(aborted) when caller signal is already aborted before request", async () => {
			const controller = new AbortController();
			controller.abort();

			const mockFetch = vi.fn();
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(
				provider.generateResponse([], [], controller.signal),
			).rejects.toMatchObject({
				kind: "aborted",
				message: "Request aborted",
			});
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("throws LLMProviderError(aborted) when signal is aborted during fetch", async () => {
			const controller = new AbortController();

			const mockFetch = vi.fn().mockImplementation((_url, init) => {
				return new Promise((_, reject) => {
					init.signal.addEventListener("abort", () => {
						reject(new DOMException("The operation was aborted", "AbortError"));
					});
					controller.abort();
				});
			});

			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(
				provider.generateResponse([], [], controller.signal),
			).rejects.toMatchObject({
				kind: "aborted",
				message: "Request aborted",
			});
		});

		it("throws LLMProviderError(network) when fetch throws general network error", async () => {
			const networkError = new Error("Failed to connect to localhost:11434");
			const mockFetch = vi.fn().mockRejectedValue(networkError);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "network",
				message: "Could not reach Ollama",
				cause: networkError,
			});
		});

		it("throws LLMProviderError(rate_limit) on HTTP 429 response with error detail", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse(
						{ error: "rate limit exceeded" },
						429,
						"Too Many Requests",
					),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "rate_limit",
				message: "Ollama returned 429: rate limit exceeded",
			});
		});

		it("throws LLMProviderError(server) on HTTP 500 without error body detail", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse("non-json-body", 500, "Internal Server Error"),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "server",
				message: "Ollama returned 500",
			});
		});

		it("throws LLMProviderError(server) on HTTP 500 with error body detail", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse(
						{ error: "out of memory" },
						500,
						"Internal Server Error",
					),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "server",
				message: "Ollama returned 500: out of memory",
			});
		});

		it("throws LLMProviderError(model_not_found) on HTTP 404 with error body detail", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse(
						{ error: "model 'unknown' not found" },
						404,
						"Not Found",
					),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "model_not_found",
				message: "Ollama returned 404: model 'unknown' not found",
			});
		});

		it("throws LLMProviderError(api) on HTTP 400 response", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse({ error: "invalid options" }, 400, "Bad Request"),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "api",
				message: "Ollama returned 400: invalid options",
			});
		});

		it("throws LLMProviderError(invalid_response) when response body is non-JSON", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse("<!DOCTYPE html><html>error</html>", 200, "OK"),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "invalid_response",
				message: "Response body is not valid JSON",
			});
		});

		it("throws LLMProviderError(invalid_response) when response fails schema validation", async () => {
			const mockFetch = vi.fn().mockResolvedValue(
				createMockResponse({
					model: "llama3.2",
					message: { role: "assistant" }, // missing content
					done: true,
				}),
			);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "invalid_response",
				message: "Ollama response invalid: message.content must be a string",
			});
		});

		it("marks timeout as retryable", async () => {
			const mockFetch = vi.fn().mockImplementation((_url, init) => {
				return new Promise((_, reject) => {
					init.signal.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				});
			});
			const provider = new OllamaProvider({
				...defaultOptions,
				timeoutMs: 20,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "timeout",
				retryable: true,
			});
		});

		it("marks network failure as retryable", async () => {
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: vi
					.fn()
					.mockRejectedValue(
						new TypeError("fetch failed"),
					) as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "network",
				retryable: true,
			});
		});

		it("marks caller abort as non-retryable", async () => {
			const controller = new AbortController();
			controller.abort();
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: vi.fn() as unknown as typeof fetch,
			});

			await expect(
				provider.generateResponse([], [], controller.signal),
			).rejects.toMatchObject({ kind: "aborted", retryable: false });
		});
	});

	describe("parseOllamaChatResponse", () => {
		const validBase = {
			model: "llama3.2",
			done: true,
			message: { role: "assistant", content: "Hello" },
		};

		it("accepts a valid chat response with content only", () => {
			expect(parseOllamaChatResponse(validBase)).toEqual(validBase);
		});

		it("accepts a valid chat response with tool_calls", () => {
			const raw = {
				model: "llama3.2",
				message: {
					role: "assistant",
					content: "",
					tool_calls: [
						{ function: { name: "search", arguments: { q: "vitest" } } },
					],
				},
				done: true,
			};
			expect(parseOllamaChatResponse(raw)).toEqual(raw);
		});

		it("fails when data is not an object", () => {
			expect(() => parseOllamaChatResponse(null)).toThrow(
				"Ollama response invalid: body must be an object",
			);
			expect(() => parseOllamaChatResponse("not an object")).toThrow(
				"Ollama response invalid: body must be an object",
			);
			expect(() => parseOllamaChatResponse([1, 2, 3])).toThrow(
				"Ollama response invalid: body must be an object",
			);
		});

		it("fails when model is not a non-empty string", () => {
			for (const invalidModel of ["", "   ", 123, null, undefined]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						model: invalidModel,
					}),
				).toThrow("Ollama response invalid: model must be a non-empty string");
			}
		});

		it("fails when done is not a boolean", () => {
			for (const invalidDone of ["true", 1, null, undefined]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						done: invalidDone,
					}),
				).toThrow("Ollama response invalid: done must be a boolean");
			}
		});

		it("fails when done is false (non-streaming required)", () => {
			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					done: false,
				}),
			).toThrow(
				"Ollama response invalid: done must be true for a non-streaming response",
			);
		});

		it("fails when message is not an object", () => {
			for (const invalidMessage of [null, "assistant", [1, 2], undefined]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						message: invalidMessage,
					}),
				).toThrow("Ollama response invalid: message must be an object");
			}
		});

		it("fails when message.role is not assistant", () => {
			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					message: { role: "user", content: "hi" },
				}),
			).toThrow('Ollama response invalid: message.role must be "assistant"');

			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					message: { role: "system", content: "hi" },
				}),
			).toThrow('Ollama response invalid: message.role must be "assistant"');
		});

		it("fails when message.content is not a string", () => {
			for (const invalidContent of [12345, null, undefined, true, {}]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						message: { role: "assistant", content: invalidContent },
					}),
				).toThrow("Ollama response invalid: message.content must be a string");
			}
		});

		it("fails when message.tool_calls is not an array", () => {
			for (const invalidToolCalls of ["not-an-array", 123, {}]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						message: {
							role: "assistant",
							content: "",
							tool_calls: invalidToolCalls,
						},
					}),
				).toThrow(
					"Ollama response invalid: message.tool_calls must be an array when present",
				);
			}
		});

		it("fails when tool_calls element is not an object", () => {
			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					message: { role: "assistant", content: "", tool_calls: [null] },
				}),
			).toThrow(
				"Ollama response invalid: message.tool_calls[0] must be an object",
			);

			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					message: {
						role: "assistant",
						content: "",
						tool_calls: ["not-an-object"],
					},
				}),
			).toThrow(
				"Ollama response invalid: message.tool_calls[0] must be an object",
			);
		});

		it("fails when tool_calls function is not an object", () => {
			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					message: {
						role: "assistant",
						content: "",
						tool_calls: [{ function: null }],
					},
				}),
			).toThrow(
				"Ollama response invalid: message.tool_calls[0].function must be an object",
			);

			expect(() =>
				parseOllamaChatResponse({
					...validBase,
					message: {
						role: "assistant",
						content: "",
						tool_calls: [{ function: "not-an-obj" }],
					},
				}),
			).toThrow(
				"Ollama response invalid: message.tool_calls[0].function must be an object",
			);
		});

		it("fails when tool_calls function.name is not a non-empty string", () => {
			for (const name of ["", "   ", 123, null, undefined]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						message: {
							role: "assistant",
							content: "",
							tool_calls: [{ function: { name, arguments: {} } }],
						},
					}),
				).toThrow(
					"Ollama response invalid: message.tool_calls[0].function.name must be a non-empty string",
				);
			}
		});

		it("fails when tool_calls function.arguments is not an object", () => {
			for (const args of [null, "invalid", [1, 2], 123, undefined]) {
				expect(() =>
					parseOllamaChatResponse({
						...validBase,
						message: {
							role: "assistant",
							content: "",
							tool_calls: [{ function: { name: "test", arguments: args } }],
						},
					}),
				).toThrow(
					"Ollama response invalid: message.tool_calls[0].function.arguments must be an object",
				);
			}
		});
	});

	describe("HTTP status mapping", () => {
		it.each([
			[400, "api", false],
			[401, "api", false],
			[403, "api", false],
			[404, "model_not_found", false],
			[429, "rate_limit", true],
			[500, "server", true],
			[503, "server", true],
		])(
			"maps HTTP %i to %s (retryable: %s)",
			async (status, kind, retryable) => {
				const mockFetch = vi
					.fn()
					.mockResolvedValue(
						createMockResponse({ error: "boom" }, status, "Status"),
					);
				const provider = new OllamaProvider({
					...defaultOptions,
					fetch: mockFetch as unknown as typeof fetch,
				});

				await expect(provider.generateResponse([], [])).rejects.toMatchObject({
					kind,
					retryable,
				});
			},
		);

		it("includes the Ollama error detail in the message", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse(
						{ error: "out of memory" },
						500,
						"Internal Server Error",
					),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "server",
				message: "Ollama returned 500: out of memory",
			});
		});

		it("omits the detail when the error body is not JSON", async () => {
			const mockFetch = vi
				.fn()
				.mockResolvedValue(
					createMockResponse(
						"plain text failure",
						500,
						"Internal Server Error",
					),
				);
			const provider = new OllamaProvider({
				...defaultOptions,
				fetch: mockFetch as unknown as typeof fetch,
			});

			await expect(provider.generateResponse([], [])).rejects.toMatchObject({
				kind: "server",
				message: "Ollama returned 500",
			});
		});
	});
});
