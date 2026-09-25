# Authoritative Compaction Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `dsh-fixes` use one evidence-gated compaction model: a durable summary boundary is the shared read-side cut, auto-compaction uses a reserve-based threshold, summarization retries without mechanical history truncation, prompt-overflow recovery retries at most once per turn, and post-compaction workspace context is rehydrated within a strict budget.

**Architecture:** This plan is scoped to the `dsh-fixes` repository. It first proves whether the current DSH core request path leaks pre-boundary surface history. The plugin then adds shared boundary recognition, policy, retry, rehydration, and client behavior around the existing `surfaceOp: replace` contract. The plugin will not patch `node_modules` or invent a second session protocol; if the evidence gate proves the core request assembler leaks old surface history, implementation stops and a separate DSH-core plan is created against the actual source checkout.

**Tech Stack:** TypeScript 5.9, Node16 host build, React 18 client bundle, Vitest, `tsdown`, Cordis host events, DSH `Session`, `llm/stream`, `agent/request-error`, `tokenMeter`, `fs`, `sessionProjections`, and `skills` services.

**Spec:** `CONTEXT.md` and `docs/adr/0001-authoritative-compaction-boundary.md`

## Global Constraints

- The implementation remains deferred behind a live request-shape evidence gate; do not claim the core boundary is broken from session-log inspection alone.
- The model-visible surface has one current active boundary; request assembly, automatic compaction, manual `/compact`, preview, and UI line selection use the same boundary reader.
- `system` and tool definitions remain request-envelope content outside the conversation cut.
- The summary has nine fixed English headings: `Primary Request and Intent`, `Key Technical Concepts`, `Files and Code`, `Errors and Fixes`, `Pending Jobs`, `Current Work`, `Next Step`, `Critical Context`, and `Validation / Verification`; the body follows the conversation language and missing sections become `(none)`.
- Default compaction reserves are 20,000 tokens for the summary request's output and 13,000 tokens for one tool result; the threshold is `max(floor(contextWindow / 2), contextWindow - 20_000 - 13_000)`.
- Route-level reserve overrides are optional; invalid or negative overrides fall back to the corresponding default.
- The existing `thresholdRatio` setting and UI slider are removed; old stored values are ignored without affecting the new formula.
- Rehydration uses at most 5 recently successful `read`, `write`, or `edit` file targets and a shared 50,000-token budget across files, todos, and skill bodies, prioritized as touched files, todo list, then skill bodies.
- File and skill rehydration failures are best-effort and never make a successful boundary commit fail.
- Original prompt-too-long recovery retries only when the attempt produced no visible output and only once per turn; partial output is never retried.
- Summary-request overflow retries remove complete oldest turns while preserving tool-call/result pairing; the first summary attempt receives the full selected input without block truncation, image replacement, or tool deletion.
- A valid summary may commit once even when it does not reduce measured tokens; a no-progress guard ends the current compaction cycle and prevents an infinite loop.
- Keep `compaction/start` and `compaction/end` lifecycle semantics for locking, persistence, and failure recovery; old sessions remain readable while new boundary-aware data is added.
- Do not edit installed DSH packages or generated `lib/` files directly. `client/client.js` and `client/client.js.map` are regenerated only by the final build.

## Scope Check and File Map

The current checkout owns the outer `dsh-fixes` plugin, not the DSH core package sources. The core producer of a new `compact_boundary` source and the official transcript projection are therefore a separate escalation path. This plan creates a compatibility reader for both the current legacy compact source and the future boundary source, but it does not monkey-patch an already-committed message's source.

Planned new units:

- `src/compaction-boundary.ts`: pure recognition of the active boundary and compatible legacy checkpoint source; exposes the cut used by the client preview.
- `src/compaction-budget.ts`: reserve defaults, route override validation, threshold calculation, and display helpers' shared numeric input.
- `src/compaction-summarizer.ts`: full-input first attempt, prompt-too-long classification, visible-output tracking, and safe whole-turn summarizer retry.
- `src/compaction-request-retry.ts`: one-retry-per-turn gate, visible assistant-attempt inspection, and no-progress state helpers.
- `src/compaction-rehydration.ts`: successful file-touch ledger, current-file reads, historical skill extraction, todo snapshot rendering, shared token budget, and message construction.

Existing units to modify:

- `src/index.ts`: remove mechanical shrink installation, register reserve-based auto policy, wrap both automatic and manual compaction through one post-compaction hook, track touches, and register request-error recovery.
- `src/fixes-settings.ts`: remove `thresholdRatio`; add and parse route-keyed `compactionReserves`.
- `src/compaction-policy.ts`: consume concrete `thresholdTokens` instead of a ratio while retaining the context-overflow trigger bridge until the core engine exposes the new policy directly.
- `src/compact-preview.ts`: derive preview and current boundary from the shared boundary reader.
- `src/panel-state.ts`, `src/client/index.ts`, and `src/context-panel-ui.ts`: remove the threshold slider and show the computed threshold/boundary state.
- `tsconfig.client.json`: include the new shared pure modules used by the client.
- `README.md`, `README.zh.md`, and `docs/superpowers/specs/2026-09-20-composer-context-controls-design.md`: document the formula, rehydration, retry limits, and boundary semantics; leave the historical implementation plan unchanged.

Existing units to remove:

- `src/compaction-shrink.ts` and `test/compaction-shrink.test.ts`: the old first-pass character truncation, image replacement, tool removal, and newest-tail fitting are replaced by a failure-triggered whole-turn retry.

## Task 1: Establish the request-boundary evidence gate

**Files:**
- Modify temporarily during local verification only: `src/index.ts` at the existing `llm/stream` wrapper site.
- No committed source changes for the diagnostic.

**Interfaces:**
- Reads `llm/stream` options, `options.sessionId`, `ctx.get("sessions").get(sessionId)`, `session.surface.nodes`, and `session.deriveMessages()`.
- Produces a redacted shape record containing counts, source kinds/plugins, and sequence positions only; never logs message content.

- [ ] Establish a clean baseline with `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Compare the exact `agent-loop` `buildRequest()` messages with the live session-derived messages and the final adapter projection; do not dump content.
- [ ] Exercise one manual and one automatic compaction when the web runtime is available.
- [ ] Proceed with plugin-side compatibility work only when no pre-boundary message appears in adapter options. If a leak appears, stop and create a separate DSH-core plan; never patch installed packages.

**Evidence ruling for this execution:** the installed runtime source shows `buildRequest()` at `@deepseek-ai/dsh-agent-loop/lib/index.js:1165-1217` assigns `messages: session.deriveMessages()`, and its dispatch passes that request directly to the prepared adapter call. `@deepseek-ai/dsh-llm/lib/index.js:2219-2259` only applies file/image representation projections before adapter dispatch. Therefore the current core path has no code path that replays pre-boundary events; the plugin work can proceed without a core protocol teardown.

## Task 2: Add the shared active-boundary reader

**Files:**
- Create `src/compaction-boundary.ts` and `test/compaction-boundary.test.ts`.
- Modify `src/compact-preview.ts` and `test/compact-preview.test.ts`.

**Interfaces:**

```ts
export type ActiveCompactionBoundary = {
  seq: number;
  boundaryId?: string;
  formatVersion?: number;
  coveredStartSeq?: number;
  coveredEndSeq?: number;
  legacy: boolean;
};

export function isCompactBoundarySource(value: unknown): boolean;
export function findActiveCompactionBoundary(session: unknown): ActiveCompactionBoundary | undefined;
export function surfaceCutBeforeBoundary(session: unknown): number;
```

- [ ] Write failing tests for future `plugin: "compact_boundary"`, current legacy `plugin: "compact"`, unrelated/malformed sources, and newest-boundary selection.
- [ ] Write failing tests for system-head cuts, boundary cuts, empty surfaces, and preview selection.
- [ ] Implement a structural JSON-safe reader without enumerating live session objects.
- [ ] Route preview selection through the reader.
- [ ] Run `npx vitest run test/compaction-boundary.test.ts test/compact-preview.test.ts`.
- [ ] Commit as `feat: define shared compaction boundary semantics`.

## Task 3: Replace the ratio slider with reserve-based budgeting

**Files:**
- Create `src/compaction-budget.ts` and `test/compaction-budget.test.ts`.
- Modify `src/fixes-settings.ts`, `test/fixes-settings.test.ts`, `src/compaction-policy.ts`, `test/compaction-policy.test.ts`, `src/index.ts`, `src/panel-state.ts`, `test/panel-state.test.ts`, and `tsconfig.client.json`.

**Interfaces:**

```ts
export type CompactionReserveOverride = {
  summaryOutputTokens?: number;
  toolResultTokens?: number;
};

export type CompactionBudget = {
  contextWindow: number;
  summaryOutputTokens: number;
  toolResultTokens: number;
  thresholdTokens: number;
};

export const DEFAULT_SUMMARY_OUTPUT_TOKENS = 20_000;
export const DEFAULT_TOOL_RESULT_TOKENS = 13_000;

export function resolveCompactionBudget(
  contextWindow: number,
  override?: CompactionReserveOverride,
): CompactionBudget | undefined;
```

- [ ] Test exact thresholds for 272K→239K, 8K→4K, 32K→16K, and a route override.
- [ ] Remove `thresholdRatio`/`clampThresholdRatio`; parse `compactionReserves[provider/model]` with safe fallback.
- [ ] Change `AutoCompactInput` to `thresholdTokens` while keeping busy/lock/enabled guards and the context-overflow bridge.
- [ ] Wire `runAutoCompact` to the effective model/session window and route override.
- [ ] Remove the ratio from `PanelState` and include the shared budget module in the client config.
- [ ] Run focused budget/settings/policy/panel tests.
- [ ] Commit as `feat: switch auto compact to reserve based thresholds`.

## Task 4: Remove mechanical summarizer shrink and add safe overflow retry

**Files:**
- Create `src/compaction-summarizer.ts` and `test/compaction-summarizer.test.ts`.
- Modify `src/index.ts`.
- Delete `src/compaction-shrink.ts` and `test/compaction-shrink.test.ts`.

**Interfaces:**

```ts
export type CompactionStreamOptions = {
  purpose?: string;
  messages?: unknown;
  provider?: string;
  model?: string;
  [key: string]: unknown;
};

export function isPromptTooLongFailure(value: unknown): boolean;
export function hasVisibleStreamOutput(value: unknown): boolean;
export function trimOldestCompleteTurns(messages: readonly unknown[]): unknown[];
export function retryCompactionStream(
  original: (options: CompactionStreamOptions) => AsyncIterable<unknown>,
  options: CompactionStreamOptions,
): AsyncIterable<unknown>;
```

- [ ] Test that the first compaction request keeps all messages/tools/images and that non-compaction requests are untouched.
- [ ] Test canonical overflow codes, conservative text fallbacks, visible output, and unrelated errors.
- [ ] Test whole-turn trimming, final instruction preservation, and tool-call/result pairing.
- [ ] Implement one failure-triggered retry only when no visible output occurred; never truncate blocks, replace images, or delete tools.
- [ ] Replace the old shrink installation while preserving provider/model routing and disposal.
- [ ] Run `npx vitest run test/compaction-summarizer.test.ts`.
- [ ] Commit as `fix: retry oversized summarization without mechanical truncation`.

## Task 5: Add one-shot original-request overflow recovery and no-progress protection

**Files:**
- Create `src/compaction-request-retry.ts` and `test/compaction-request-retry.test.ts`.
- Modify `src/index.ts` and `test/compaction-policy.test.ts`.

**Interfaces:**

```ts
export type CompactionRetryGate = {
  canRetry(agent: object, turn: number): boolean;
  markRetried(agent: object, turn: number): void;
  reset(agent?: object): void;
};

export function createCompactionRetryGate(): CompactionRetryGate;
export function sessionAttemptHasVisibleOutput(session: unknown): boolean;
export function shouldRetryRequestAfterCompaction(input: {
  failure: unknown;
  outputStarted: boolean;
  alreadyRetried: boolean;
}): boolean;
```

- [ ] Test one retry per agent/turn, reset, cancellation, partial output, and unrelated errors.
- [ ] Test assistant attempt stream visibility and fail-closed malformed sessions.
- [ ] Register `agent/request-error`; compact through the shared context-overflow path and return `{ kind: "retry" }` only after a successful commit.
- [ ] Wrap both `compactIfNeeded` and `compactNow` once with one shared post-compaction hook.
- [ ] Track no-progress per agent/turn so a committed but non-shrinking summary cannot loop.
- [ ] Run focused retry/policy tests.
- [ ] Commit as `fix: retry prompt overflow once after compaction`.

## Task 6: Rehydrate current workspace context after a successful boundary

**Files:**
- Create `src/compaction-rehydration.ts` and `test/compaction-rehydration.test.ts`.
- Modify `src/index.ts`.

**Interfaces:**

```ts
export const MAX_REHYDRATION_FILES = 5;
export const MAX_REHYDRATION_TOKENS = 50_000;

export type FileTouch = { path: string; order: number };
export type RehydrationItem = {
  kind: "file" | "todo" | "skill";
  name: string;
  text: string;
};

export function selectRecentFileTouches(touches: readonly FileTouch[]): string[];
export function renderRehydrationMessage(items: readonly RehydrationItem[], tokenLimit: number): unknown;
export function skillBodiesFromSession(session: unknown): RehydrationItem[];
export function todoItemsFromProjection(value: unknown): RehydrationItem | undefined;
```

- [ ] Test newest file deduplication, five-file cap, shared budget, priority order, stable sections, and omission when content does not fit.
- [ ] Record successful non-aborted `read`, `write`, and `edit` `file_path` touches, bubbling nested execution to the root agent.
- [ ] Read current files through `fs.resolve`/`stat`/`readText`, skipping failures and non-files; use `tokenMeter.estimateMessage` or a four-character fallback for budgeting.
- [ ] Extract persisted skill invocation bodies and latest todo projection without loading stale workspace files.
- [ ] Append one snapshot-style `user/message` after a successful compaction and flush it best-effort.
- [ ] Run `npx vitest run test/compaction-rehydration.test.ts`.
- [ ] Commit as `feat: rehydrate workspace context after compaction`.

## Task 7: Align the Context panel and documentation with the shared boundary

**Files:**
- Modify `src/client/index.ts`, `src/context-panel-ui.ts`, `src/compact-preview.ts`, relevant tests, `README.md`, `README.zh.md`, `docs/superpowers/specs/2026-09-20-composer-context-controls-design.md`, and the ADR status after acceptance.

- [ ] Add failing helper tests for formula labels, missing windows, legacy/new boundaries, and empty previews.
- [ ] Remove `draftPercent`, range input, and all threshold-ratio writes; display the computed threshold and retain the auto toggle/session override.
- [ ] Render current boundary/summary/rehydration preview using the same host/client reader and cut.
- [ ] Update English/Chinese docs and the composer spec; leave the historical implementation plan unchanged.
- [ ] Run focused client tests and `npm run typecheck`.
- [ ] Commit as `feat: align context controls with compaction boundaries`.

## Task 8: Full verification and release handoff

**Files:**
- Regenerate `client/client.js` and `client/client.js.map` with the build.
- Do not edit generated `lib/` output directly.

- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [ ] Verify the live acceptance matrix: 272K→239K, small-window floors, identical manual/automatic boundary and rehydration, no pre-boundary adapter messages, one-shot prompt retry, safe summarizer retry, best-effort file failures, old-session compatibility, and no ratio slider.
- [ ] Change the ADR from `proposed` to `accepted` only after the evidence gate and live matrix pass.
- [ ] Review `git status --short`, `git diff --stat`, and the final diff for accidental edits outside this feature.

## Separate DSH-core escalation

If the evidence gate ever shows that final adapter options contain pre-boundary messages, stop before treating plugin compatibility code as the fix. Create a separate plan in the real DSH core source checkout for the compaction message-source contract, `dsh-compaction-basic` durable replacement transaction, lifecycle/result types, official conversation projection, and old-log migration tests. The generated packages under `node_modules` are evidence only and must not be edited.