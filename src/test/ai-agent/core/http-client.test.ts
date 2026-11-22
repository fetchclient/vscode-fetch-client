import { afterEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_TIMEOUT_MS,
	describeError,
	err,
	formBody,
	get,
	jsonBody,
	MAX_TIMEOUT_MS,
	ok,
	post,
	request,
	textBody,
} from "../../../fetch-client-ai-agent/core/http";
import type { HttpClientError } from "../../../fetch-client-ai-agent/core/http";

function jsonResponse(
	data: unknown,
	init: ResponseInit = { status: 200 },
): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
}

function waitForAbort(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(new DOMException("The operation was aborted", "AbortError"));
			return;
		}

		signal.addEventListener(
			"abort",
			() => reject(new DOMException("The operation was aborted", "AbortError")),
			{ once: true },
		);
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("HTTP client", () => {
	describe("request and response handling", () => {
		it("returns parsed data for a successful JSON response", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: "Ada" })),
			);

			const result = await get<{ id: number; name: string }>(
				"https://example.test/users/1",
			);

			expect(result).toEqual({
				ok: true,
				data: { id: 1, name: "Ada" },
			});
		});

		it("uses custom fetch function when provided in options", async () => {
			const customFetch = vi
				.fn()
				.mockResolvedValue(jsonResponse({ message: "custom fetch used" }));
			const globalFetch = vi.fn();
			vi.stubGlobal("fetch", globalFetch);

			const result = await request<{ message: string }>(
				"https://example.test/custom",
				{
					fetch: customFetch as unknown as typeof fetch,
				},
			);

			expect(result).toEqual({
				ok: true,
				data: { message: "custom fetch used" },
			});
			expect(customFetch).toHaveBeenCalledTimes(1);
			expect(globalFetch).not.toHaveBeenCalled();
		});

		it("defaults method to GET and sets default Accept header", async () => {
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
			vi.stubGlobal("fetch", fetchMock);

			await request("https://example.test/default-options");

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(init.method).toBe("GET");
			const headers = new Headers(init.headers);
			expect(headers.get("Accept")).toBe("application/json");
		});

		it("supports other HTTP methods (PUT, PATCH, DELETE)", async () => {
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ done: true }));
			vi.stubGlobal("fetch", fetchMock);

			for (const method of ["PUT", "PATCH", "DELETE"] as const) {
				await request("https://example.test/resource", { method });
				const [, init] = fetchMock.mock.lastCall as [string, RequestInit];
				expect(init.method).toBe(method);
			}
		});

		it("preserves custom headers and custom Accept header", async () => {
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
			vi.stubGlobal("fetch", fetchMock);

			await request("https://example.test/custom-headers", {
				headers: {
					Accept: "text/plain",
					Authorization: "Bearer token-123",
					"X-Custom-Header": "value",
				},
			});

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Accept")).toBe("text/plain");
			expect(headers.get("Authorization")).toBe("Bearer token-123");
			expect(headers.get("X-Custom-Header")).toBe("value");
		});

		it("returns success with undefined data for a 204 response", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
			);

			const result = await get<void>("https://example.test/no-content");

			expect(result).toEqual({ ok: true, data: undefined });
		});

		it("returns success with undefined data for a 200 response with empty body", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(new Response("", { status: 200 })),
			);

			const result = await get("https://example.test/empty-body");

			expect(result).toEqual({ ok: true, data: undefined });
		});
	});

	describe("request body handling", () => {
		it("sets JSON Content-Type and serializes a JSON body", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(jsonResponse({ created: true }));
			vi.stubGlobal("fetch", fetchMock);

			await post("https://example.test/users", jsonBody({ name: "Ada" }));

			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const headers = new Headers(init.headers);

			expect(headers.get("Content-Type")).toBe("application/json");
			expect(init.body).toBe(JSON.stringify({ name: "Ada" }));
		});

		it("does not overwrite user-supplied Content-Type for JSON body", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(jsonResponse({ created: true }));
			vi.stubGlobal("fetch", fetchMock);

			await request("https://example.test/users", {
				method: "POST",
				headers: { "Content-Type": "application/vnd.api+json" },
				body: jsonBody({ name: "Ada" }),
			});

			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const headers = new Headers(init.headers);
			expect(headers.get("Content-Type")).toBe("application/vnd.api+json");
		});

		it("handles textBody with default Content-Type", async () => {
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
			vi.stubGlobal("fetch", fetchMock);

			await request("https://example.test/text", {
				method: "POST",
				body: textBody("plain text content"),
			});

			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const headers = new Headers(init.headers);
			expect(headers.get("Content-Type")).toBe("text/plain;charset=UTF-8");
			expect(init.body).toBe("plain text content");
		});

		it("handles textBody with custom Content-Type", async () => {
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
			vi.stubGlobal("fetch", fetchMock);

			await request("https://example.test/xml", {
				method: "POST",
				body: textBody("<xml>test</xml>", "application/xml"),
			});

			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const headers = new Headers(init.headers);
			expect(headers.get("Content-Type")).toBe("application/xml");
			expect(init.body).toBe("<xml>test</xml>");
		});

		it("does not set multipart Content-Type for FormData using formBody helper", async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(jsonResponse({ uploaded: true }));
			vi.stubGlobal("fetch", fetchMock);

			const form = new FormData();
			form.append("name", "Ada");

			await post("https://example.test/upload", formBody(form));

			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const headers = new Headers(init.headers);

			expect(headers.has("Content-Type")).toBe(false);
			expect(init.body).toBe(form);
		});

		it("returns a request error when JSON serialization fails", async () => {
			const circular: { self?: unknown } = {};
			circular.self = circular;

			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);

			const result = await post("https://example.test/data", jsonBody(circular));

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("request");
			}
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("returns a request error when JSON body data is undefined", async () => {
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);

			const result = await post("https://example.test/data", jsonBody(undefined));

			expect(result).toEqual({
				ok: false,
				error: {
					kind: "request",
					message: "JSON request body is not serializable",
					cause: expect.any(TypeError),
				},
			});
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe("HTTP error responses", () => {
		it("returns an HTTP error and preserves a JSON error body", async () => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(
						jsonResponse(
							{ message: "Not found" },
							{ status: 404, statusText: "Not Found" },
						),
					),
			);

			const result = await get("https://example.test/missing");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toMatchObject({
					kind: "http",
					status: 404,
					statusText: "Not Found",
					body: { message: "Not found" },
				});
			}
		});

		it("preserves a plain-text HTTP error body", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					new Response("upstream unavailable", {
						status: 503,
						statusText: "Service Unavailable",
					}),
				),
			);

			const result = await request("https://example.test/unavailable");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toMatchObject({
					kind: "http",
					status: 503,
					body: "upstream unavailable",
				});
			}
		});

		it("preserves undefined body when error response body is empty", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					new Response("", {
						status: 500,
						statusText: "Internal Server Error",
					}),
				),
			);

			const result = await request("https://example.test/empty-error");

			expect(result).toEqual({
				ok: false,
				error: {
					kind: "http",
					status: 500,
					statusText: "Internal Server Error",
					body: undefined,
				},
			});
		});
	});

	describe("response parsing and validation", () => {
		it("returns a parse error when a successful response contains invalid JSON", async () => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(new Response("{ invalid json", { status: 200 })),
			);

			const result = await get("https://example.test/invalid-json");

			expect(result).toEqual({
				ok: false,
				error: {
					kind: "parse",
					message: "Response body is not valid JSON",
				},
			});
		});

		it("returns a parse error when the caller's validator throws an Error", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(jsonResponse({ id: "bad" })),
			);

			const result = await request<{ id: number }>("https://example.test/user", {
				parse: () => {
					throw new Error("id must be a number");
				},
			});

			expect(result).toEqual({
				ok: false,
				error: { kind: "parse", message: "id must be a number" },
			});
		});

		it("returns a parse error with default message when the caller's validator throws non-Error", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(jsonResponse({ id: "bad" })),
			);

			const result = await request<{ id: number }>("https://example.test/user", {
				parse: () => {
					throw "invalid custom exception";
				},
			});

			expect(result).toEqual({
				ok: false,
				error: { kind: "parse", message: "Validation failed" },
			});
		});
	});

	describe("network and cancellation", () => {
		it("returns a network error when fetch rejects without cancellation", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
			);

			const result = await get("https://example.test/offline");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("network");
				if (result.error.kind === "network") {
					expect(result.error.message).toBe("Failed to fetch");
				}
			}
		});

		it("handles non-Error rejection as network error with string representation", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockRejectedValue("raw network failure string"),
			);

			const result = await get("https://example.test/offline-string");

			expect(result).toEqual({
				ok: false,
				error: {
					kind: "network",
					message: "raw network failure string",
					cause: "raw network failure string",
				},
			});
		});

		it("returns aborted when the caller signal is already aborted", async () => {
			const controller = new AbortController();
			controller.abort();

			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);

			const result = await get("https://example.test/cancelled", {
				signal: controller.signal,
			});

			expect(result).toEqual({
				ok: false,
				error: { kind: "aborted" },
			});
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("returns aborted when the caller cancels an in-flight request", async () => {
			const controller = new AbortController();

			vi.stubGlobal(
				"fetch",
				vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
					return waitForAbort(init!.signal as AbortSignal);
				}),
			);

			const pending = get("https://example.test/cancel", {
				timeoutMs: 1000,
				signal: controller.signal,
			});

			controller.abort();

			const result = await pending;

			expect(result).toEqual({
				ok: false,
				error: { kind: "aborted" },
			});
		});
	});

	describe("timeout handling", () => {
		it("returns a timeout error when fetch does not complete in time", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
					return waitForAbort(init!.signal as AbortSignal);
				}),
			);

			const result = await request("https://example.test/slow", {
				timeoutMs: 15,
			});

			expect(result).toEqual({
				ok: false,
				error: { kind: "timeout", timeoutMs: 15 },
			});
		});

		it("returns a timeout error when reading the response body stalls", async () => {
			let activeSignal: AbortSignal;

			const response = {
				ok: true,
				status: 200,
				statusText: "OK",
				text: vi.fn(
					(_encoding?: string) =>
						new Promise<string>((_, reject) => {
							activeSignal!.addEventListener(
								"abort",
								() => reject(new DOMException("Aborted", "AbortError")),
								{ once: true },
							);
						}),
				),
			} as unknown as Response;

			vi.stubGlobal(
				"fetch",
				vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
					activeSignal = init!.signal as AbortSignal;
					return Promise.resolve(response);
				}),
			);

			const result = await request("https://example.test/stalled-body", {
				timeoutMs: 15,
			});

			expect(result).toEqual({
				ok: false,
				error: { kind: "timeout", timeoutMs: 15 },
			});
		});

		it("rejects with RangeError for invalid timeout configuration", async () => {
			await expect(
				request("https://example.test", { timeoutMs: 0 }),
			).rejects.toBeInstanceOf(RangeError);

			await expect(
				request("https://example.test", { timeoutMs: -1 }),
			).rejects.toBeInstanceOf(RangeError);

			await expect(
				request("https://example.test", { timeoutMs: Number.POSITIVE_INFINITY }),
			).rejects.toBeInstanceOf(RangeError);

			await expect(
				request("https://example.test", { timeoutMs: Number.NaN }),
			).rejects.toBeInstanceOf(RangeError);

			await expect(
				request("https://example.test", { timeoutMs: MAX_TIMEOUT_MS + 1 }),
			).rejects.toBeInstanceOf(RangeError);
		});
	});

	describe("helpers and error formatting", () => {
		it("exports default and maximum timeout constants", () => {
			expect(DEFAULT_TIMEOUT_MS).toBe(5000);
			expect(MAX_TIMEOUT_MS).toBe(2_147_483_647);
		});

		it("constructs Ok and Err objects correctly via ok and err helpers", () => {
			expect(ok("data-value")).toEqual({ ok: true, data: "data-value" });
			expect(err("error-value")).toEqual({ ok: false, error: "error-value" });
		});

		it("formats each HTTP client error kind into a readable message", () => {
			const cases: Array<[HttpClientError, string]> = [
				[
					{
						kind: "http",
						status: 429,
						statusText: "Too Many Requests",
						body: null,
					},
					"HTTP 429 Too Many Requests",
				],
				[{ kind: "network", message: "offline" }, "Network error: offline"],
				[{ kind: "timeout", timeoutMs: 1000 }, "Timed out after 1000 ms"],
				[{ kind: "aborted" }, "Request was cancelled"],
				[
					{ kind: "parse", message: "invalid JSON" },
					"Bad response: invalid JSON",
				],
				[
					{ kind: "request", message: "cannot serialize" },
					"Request error: cannot serialize",
				],
			];

			for (const [error, expected] of cases) {
				expect(describeError(error)).toBe(expected);
			}
		});
	});
});