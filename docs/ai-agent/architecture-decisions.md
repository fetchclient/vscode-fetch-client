# Fetch Client AI Agent: Architecture Decisions

## 1. Platform decisions

| ID  | Decision                                                     | Reason                                     |
| --- | ------------------------------------------------------------ | ------------------------------------------ |
| D01 | Keep the AI Agent Platform independent of Fetch Client.      | Reusability                                |
| D02 | Use a common model-provider interface.                       | Reduce provider lock-in                    |
| D03 | Keep provider-specific behavior inside provider adaptors.    | Isolate API differences                    |
| D04 | Make tools modular and discoverable through a tool registry. | Extensibility                              |
| D05 | Connect applications through dedicated adaptors.             | Loose coupling                             |
| D06 | Use Fetch Client as the first application integration.       | Validate the platform with a real use case |
| D07 | Keep detailed security design separate.                      | Allow focused security design              |
| D08 | Keep detailed data-flow and storage design separate.         | Avoid premature implementation decisions   |
| D09 | Leave deployment architecture undecided for now.             | Preserve implementation flexibility        |

**Links**

- D07: security design is in `provider-configuration-design.md` (Day 15, DS-01 to DS-09).
- D08: the data-sharing rules in `provider-configuration-design.md` are the data-flow input to storage design.

## 2. Product principles and boundaries

- Product goal: an independent, extensible, secure AI Agent platform. Security, privacy, safety, and measurable evidence are first-class requirements.
- Security Policy Engine decisions: Allow, Warn, Require Approval, Block. Authorised API security testing must not be blocked by payload pattern alone.
- The agent is an orchestration layer. It reuses existing Fetch Client services (apiFetch, repositories, variable resolution, PreFetchRunner) and does not reimplement them.
- The agent core does not access LokiJS directly and does not depend on VS Code APIs. The VS Code UI is an adapter.
- Secrets, AWS secret values, and encryption keys are never exposed to the LLM by default.
- LLM output is untrusted. Every tool call goes through a Security Manager, and the LLM cannot bypass it.
- AI proposes changes. Fetch Client validates, previews, enforces explicit approval, and saves through application services.
- Approval is bound to the exact proposal version. A changed proposal invalidates the earlier approval.
- No silent overwrite. Rejected, cancelled, or failed proposals leave the collection unchanged.
- First workflow: OpenAPI import, then request/test generation, then preview, then approval, then save. Importing a spec does not execute its endpoints.
- Planned tools include validateOpenApi, getCollectionContext, generateRequestProposal, validateGeneratedProposal, previewProposedChanges, applyApprovedChanges, and getOperationStatus. There is no generic executeCode tool and no raw DB query tool.

## 3. Orchestrator design (2026-11-20)

- `AgentOrchestrator` implements the public `Agent` interface. The host receives only `Agent`, never the dependencies.
- Policy is checked before every tool call.
- Approval pauses the run until `respondToApproval`. On approve, the orchestrator calls grant, then verify, before dispatch.
- Only one active task at a time.
- A step limit caps the LLM loop.

## 4. Provider data-sharing decisions (Day 15, 2026-11-24)

| ID     | Decision                                                                                                                                 | Status                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| DS-01  | Secret, Sensitive, and Unknown variables are never resolved for AI context. Sensitive values are removed, not resolved and then redacted. Pattern masking is backup only. | Accepted                              |
| DS-02  | Per-task approval is the default. Per-call is available.                                                                                 | Accepted                              |
| DS-03  | Credential and secret defaults are identical for all providers.                                                                          | Accepted                              |
| DS-04  | A read-only AI Context Preview is built from the exact submitted bytes, reusing existing viewers.                                        | Accepted                              |
| DS-05  | Per-session approval is an explicit opt-in with a visible indicator. It is invalidated by a change to provider, model, endpoint, or policy. | Accepted                              |
| DS-06  | Sensitive data is excluded from logs, telemetry, errors, and history from the first implementation step.                                 | Accepted                              |
| DS-07  | Provider retention verification.                                                                                                         | Pending verification                  |
| DS-08  | Local or remote classification comes from the resolved endpoint. Remote endpoints require HTTPS.                                         | Accepted                              |
| DS-09  | The approval fingerprint covers providerId, modelId, normalized endpoint, classification, policyVersion, and exact payload bytes.        | Accepted                              |

## 5. Error logging and sensitive data protection

- Raw exception messages must never be written to application logs, telemetry, or crash reports.
- Raw exception text must not be returned to the UI or exposed to the LLM.
- Only normalized error codes, categories, and retryability information may be logged.
- Request and response payloads, credentials, and sensitive context must never be included in logs.
- HTTP instrumentation and crash-reporting integrations must not capture sensitive request or response data.
- Errors must be normalized before logging or propagation.
- Decision (DS-06): raw exception text is neither logged nor returned. Only sanitized, structured error information is permitted.

## 6. Open decisions

- OD-01: session recovery (deferred)
- OD-02: UI selection and preview (preferred: read-only preview reusing components; see DS-04)
- OD-03: LokiJS atomic save (investigate)
- OD-05: duplicate test identification
