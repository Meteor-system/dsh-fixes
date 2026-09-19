# Composer Context Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a composer **Context** chip that sets the current model's global window (100k/200k/500k/1M), picks one cheap summarizer, slides auto-compact at 20–90% of that window, and compact the current session.

**Architecture:** Keep all of this in `dsh-fixes`. Host owns a `dsh-fixes` settings section, mirrors window writes into `llm-pi-ai`, wraps compaction `llm.stream` (existing shrink + summarizer override), and runs auto-compact on global `agent/pre-step`. Client registers on `conversation.input.left` and talks to Host through settings + one compact RPC. Do not replace `conversation.input.model`. Do not edit shipped presets.

**Tech Stack:** TypeScript, Vitest, Cordis Host plugin, React `createElement` Client (tsdown), DSH settings + conversation slots.

**Spec:** `docs/superpowers/specs/2026-09-20-composer-context-controls-design.md`

## Global Constraints

- Window choice applies to the current chat model globally (all sessions using that model).
- Auto-compact threshold is a percentage of that model's window (stored `0.20`–`0.90`, default `0.40`).
- Summarization uses one global `{ provider, model }`; empty means current chat model.
- Compact button affects only the current session.
- Do not replace `conversation.input.model`.
- Do not change a model's `llm-pi-ai` window unless the user set it in this panel (or it is already in `dsh-fixes.contextWindows`).
- Do not edit shipped Agent presets.
- Client must not write `settings.yaml` itself; Host writes.
- Existing image-input, DuckDuckGo, and compaction-shrink behavior must keep working.

## File map

- Create: `src/fixes-settings.ts` — parse/serialize `dsh-fixes` section, window chips, threshold clamp
- Create: `src/apply-window.ts` — write one model's `contextWindow` in `llm-pi-ai` providers
- Create: `src/compaction-policy.ts` — `shouldAutoCompact` predicate
- Modify: `src/compaction-shrink.ts` — also override provider/model when summarizer is set
- Modify: `src/index.ts` — register settings, wrap stream, pre-step, compact RPC
- Create: `src/client/index.ts` — Context chip + popover on `conversation.input.left`
- Modify: `package.json` — client export, tsdown build, peer/client inject
- Modify: `README.md` / `README.zh.md` — user-facing controls

---

### Task 1: `dsh-fixes` settings helpers

**Files:**
- Create: `src/fixes-settings.ts`
- Test: `test/fixes-settings.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const FIXES_NAMESPACE = "dsh-fixes"`
  - `export const WINDOW_CHOICES = [100000, 200000, 500000, 1000000] as const`
  - `export type WindowChoice = (typeof WINDOW_CHOICES)[number]`
  - `export type Summarization = { provider: string; model: string }`
  - `export type FixesSettings = { contextWindows: Record<string, WindowChoice>; summarization: Summarization | null; thresholdRatio: number }`
  - `export function modelKey(provider: string, model: string): string` — `"provider/model"`
  - `export function parseFixesSettings(raw: unknown): FixesSettings`
  - `export function clampThresholdRatio(value: unknown): number` — finite numbers clamped to `[0.2, 0.9]`, else `0.4`
  - `export function nearestWindowChoice(tokens: number): WindowChoice`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  clampThresholdRatio,
  modelKey,
  nearestWindowChoice,
  parseFixesSettings,
} from "../src/fixes-settings.ts";

describe("parseFixesSettings", () => {
  it("defaults an empty section", () => {
    expect(parseFixesSettings(undefined)).toEqual({
      contextWindows: {},
      summarization: null,
      thresholdRatio: 0.4,
    });
  });

  it("keeps a stored grok window, summarizer, and slider", () => {
    expect(
      parseFixesSettings({
        contextWindows: { "routincodex/grok-4.6": 500000 },
        summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
        thresholdRatio: 0.35,
      }),
    ).toEqual({
      contextWindows: { "routincodex/grok-4.6": 500000 },
      summarization: { provider: "routincodex", model: "gpt-5.4-mini" },
      thresholdRatio: 0.35,
    });
  });
});

describe("clampThresholdRatio", () => {
  it("clamps and defaults", () => {
    expect(clampThresholdRatio(0.05)).toBe(0.2);
    expect(clampThresholdRatio(1)).toBe(0.9);
    expect(clampThresholdRatio("nope")).toBe(0.4);
  });
});

describe("nearestWindowChoice", () => {
  it("snaps 262144 to 200000", () => {
    expect(nearestWindowChoice(262144)).toBe(200000);
  });
});

describe("modelKey", () => {
  it("joins provider and model", () => {
    expect(modelKey("routincodex", "grok-4.6")).toBe("routincodex/grok-4.6");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fixes-settings.test.ts`

Expected: FAIL — cannot find `../src/fixes-settings.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export const FIXES_NAMESPACE = "dsh-fixes";
export const WINDOW_CHOICES = [100000, 200000, 500000, 1000000] as const;
export type WindowChoice = (typeof WINDOW_CHOICES)[number];
export type Summarization = { provider: string; model: string };
export type FixesSettings = {
  contextWindows: Record<string, WindowChoice>;
  summarization: Summarization | null;
  thresholdRatio: number;
};

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function clampThresholdRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.4;
  if (value < 0.2) return 0.2;
  if (value > 0.9) return 0.9;
  return value;
}

export function nearestWindowChoice(tokens: number): WindowChoice {
  let best: WindowChoice = 100000;
  let bestDelta = Infinity;
  for (const choice of WINDOW_CHOICES) {
    const delta = Math.abs(choice - tokens);
    if (delta < bestDelta) {
      best = choice;
      bestDelta = delta;
    }
  }
  return best;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFixesSettings(raw: unknown): FixesSettings {
  if (!isRecord(raw)) {
    return { contextWindows: {}, summarization: null, thresholdRatio: 0.4 };
  }
  const contextWindows: Record<string, WindowChoice> = {};
  if (isRecord(raw.contextWindows)) {
    for (const [key, tokens] of Object.entries(raw.contextWindows)) {
      if (typeof tokens === "number" && (WINDOW_CHOICES as readonly number[]).includes(tokens)) {
        contextWindows[key] = tokens as WindowChoice;
      }
    }
  }
  let summarization: Summarization | null = null;
  if (isRecord(raw.summarization) && typeof raw.summarization.provider === "string" && typeof raw.summarization.model === "string") {
    if (raw.summarization.provider.length > 0 && raw.summarization.model.length > 0) {
      summarization = { provider: raw.summarization.provider, model: raw.summarization.model };
    }
  }
  return {
    contextWindows,
    summarization,
    thresholdRatio: clampThresholdRatio(raw.thresholdRatio),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fixes-settings.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fixes-settings.ts test/fixes-settings.test.ts
git commit -m "feat: parse dsh-fixes context control settings"
```

---

### Task 2: Mirror a panel window into `llm-pi-ai`

**Files:**
- Create: `src/apply-window.ts`
- Test: `test/apply-window.test.ts`

**Interfaces:**
- Consumes: `modelKey` is not required here; function takes provider/model/window
- Produces:
  - `export function applyModelWindow(providers: unknown, provider: string, model: string, contextWindow: number): { providers: unknown; patched: boolean }`
  - Only the matching model row (or `modelOverrides` entry) is written. Other models unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyModelWindow } from "../src/apply-window.ts";

describe("applyModelWindow", () => {
  it("sets grok-4.6 only", () => {
    const { providers, patched } = applyModelWindow(
      {
        routincodex: {
          models: [
            { id: "gpt-5.4-mini", contextWindow: 131072 },
            { id: "grok-4.6", contextWindow: 500000 },
          ],
        },
      },
      "routincodex",
      "grok-4.6",
      200000,
    );
    expect(patched).toBe(true);
    expect(providers.routincodex.models[0].contextWindow).toBe(131072);
    expect(providers.routincodex.models[1].contextWindow).toBe(200000);
  });

  it("is a no-op for an unknown model", () => {
    const source = { routin: { models: [{ id: "mimo-v2.5-pro" }] } };
    const { providers, patched } = applyModelWindow(source, "routincodex", "grok-4.6", 500000);
    expect(patched).toBe(false);
    expect(providers).toBe(source);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply-window.test.ts`

Expected: FAIL — cannot find `../src/apply-window.ts`

- [ ] **Step 3: Write minimal implementation**

Walk `providers[provider].models` for `id === model` and `modelOverrides[model]`. Clone only dirty objects. Set `contextWindow`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply-window.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/apply-window.ts test/apply-window.test.ts
git commit -m "feat: write one llm-pi-ai model contextWindow from the panel"
```

---

### Task 3: Auto-compact predicate

**Files:**
- Create: `src/compaction-policy.ts`
- Test: `test/compaction-policy.test.ts`

**Interfaces:**
- Consumes: `clampThresholdRatio` from `src/fixes-settings.ts`
- Produces:
  - `export type AutoCompactInput = { estimatedTokens: number; contextWindow: number; thresholdRatio: number; busy: boolean; locked: boolean }`
  - `export function shouldAutoCompact(input: AutoCompactInput): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { shouldAutoCompact } from "../src/compaction-policy.ts";

describe("shouldAutoCompact", () => {
  it("fires at or above window * ratio", () => {
    expect(
      shouldAutoCompact({
        estimatedTokens: 200000,
        contextWindow: 500000,
        thresholdRatio: 0.4,
        busy: false,
        locked: false,
      }),
    ).toBe(true);
  });

  it("skips below threshold, when busy, or when locked", () => {
    const base = {
      estimatedTokens: 200000,
      contextWindow: 500000,
      thresholdRatio: 0.4,
      busy: false,
      locked: false,
    };
    expect(shouldAutoCompact({ ...base, estimatedTokens: 199999 })).toBe(false);
    expect(shouldAutoCompact({ ...base, busy: true })).toBe(false);
    expect(shouldAutoCompact({ ...base, locked: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compaction-policy.test.ts`

Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```ts
export function shouldAutoCompact(input: {
  estimatedTokens: number;
  contextWindow: number;
  thresholdRatio: number;
  busy: boolean;
  locked: boolean;
}): boolean {
  if (input.busy || input.locked) return false;
  if (!(input.contextWindow > 0) || !(input.estimatedTokens >= 0)) return false;
  return input.estimatedTokens >= input.contextWindow * input.thresholdRatio;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compaction-policy.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/compaction-policy.ts test/compaction-policy.test.ts
git commit -m "feat: decide auto-compact from window percentage"
```

---

### Task 4: Compaction stream uses the global summarizer

**Files:**
- Modify: `src/compaction-shrink.ts`
- Test: `test/compaction-shrink.test.ts`

**Interfaces:**
- Consumes: existing `shrinkCompactionOptions(options, budgetChars?)`
- Produces: `export function shrinkCompactionOptions(options, budgetChars?, summarization?: { provider: string; model: string } | null)`
  - When `options.purpose === "compaction"` and `summarization` is non-null, returned options use that `provider`/`model`
  - Non-compaction calls still return the same object reference

- [ ] **Step 1: Write the failing test** (append to `test/compaction-shrink.test.ts`)

```ts
it("routes compaction calls to the configured summarizer", () => {
  const result = shrinkCompactionOptions(
    {
      purpose: "compaction",
      provider: "routincodex",
      model: "grok-4.6",
      messages: [{ role: "user", content: [{ type: "text", text: "sum" }] }],
    },
    undefined,
    { provider: "routincodex", model: "gpt-5.4-mini" },
  );
  expect(result.provider).toBe("routincodex");
  expect(result.model).toBe("gpt-5.4-mini");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compaction-shrink.test.ts`

Expected: FAIL — extra argument ignored, `model` still `grok-4.6`

- [ ] **Step 3: Write minimal implementation**

If `purpose === "compaction"` and summarization is set, copy `provider`/`model` onto the cloned options after shrink.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compaction-shrink.test.ts`

Expected: PASS (existing three tests still pass)

- [ ] **Step 5: Commit**

```bash
git add src/compaction-shrink.ts test/compaction-shrink.test.ts
git commit -m "feat: send compaction summaries to the cheap model"
```

---

### Task 5: Host wiring — settings, wrap, pre-step, compact RPC

**Files:**
- Modify: `src/index.ts`
- Test: `test/fill-image-input.test.ts` (must still pass)
- Test: `test/host-controls.test.ts` for pure helpers extracted if `apply` stays thick — prefer exporting `readFixesPanelState` from `src/fixes-settings.ts` or a new `src/panel-state.ts`

**Interfaces:**
- Consumes: `parseFixesSettings`, `applyModelWindow`, `shouldAutoCompact`, `shrinkCompactionOptions`, `patchProviders`, `patchContextWindows`
- Produces Host plugin:
  - `inject: ["settings", "timer"]` plus `ctx.get("llm")`, `ctx.get("compaction")` optional
  - Register settings namespace `dsh-fixes` with a schemastery object `{ contextWindows: dict, summarization: object, thresholdRatio: number }` if `ctx.settings.register` exists; otherwise keep get/update of the raw section
  - `llm.stream` wrap: `shrinkCompactionOptions(options, undefined, parseFixesSettings(settings.get("dsh-fixes")).summarization)`
  - `ctx.on("agent/pre-step", handler, { global: true })`:
    - `busy` = agent status is not idle (if `agent.status === "idle"` or no open turn — use `payload.agent` if it has `status`, else skip when `payload.signal.aborted`)
    - `locked` = skip if `agent.session` compaction lock cannot be read; if unsure, only skip when `compactIfNeeded` throws busy
    - tokens: `ctx.get("tokenMeter")` if present with a session total; if missing, skip auto-compact (do not guess)
    - window: `llm.resolveModelInfo(provider, model)` `context.contextWindow`
    - if `shouldAutoCompact`, call `agent.ctx.get("compaction")?.compactIfNeeded?.(agent, "pressure", signal)` or `ctx.get("compaction")` — try agent ctx first
  - Provide JSON methods for the client using whatever the web profile already uses for plugin RPC. If no remote helper is mounted, register `ctx.router` is forbidden; instead persist via settings (window/summarizer/slider) and implement compact as:
    - Client triggers the existing `/compact` command when available
    - Host also exports `export async function compactCurrentSession(agent): Promise<{ ok: true } | { ok: false; error: string }>` used by a `ctx.on("command")` only if you add a `commands` inject. Prefer: `inject` optionally `"commands"` and register a silent command `context-compact` that calls `ctx.compaction.compactNow`. If `compaction` is isolate-only, compactNow must run on `payload.agent` from a session-scoped command. Document the fallback: the Client sends `/compact` through `inputActions` if that API exists on the slot.

Because isolate compaction is the hard part, lock this behavior:

1. Auto-compact and Compact button both go through **the agent that owns the session**, never a host-plane `ctx.compaction` (web-app disables host compaction-basic).
2. In `agent/pre-step`, the payload includes `agent`. Call `agent.ctx.get("compaction")`. If undefined, log once and skip.
3. For the button, register command `context-compact` on `ctx.get("commands")` when present; Client invokes that command name. If commands is missing, Client types `/compact` via the composer command path already used by the product.

- [ ] **Step 1: Write failing tests for panel state reduction**

Create `src/panel-state.ts` + `test/panel-state.test.ts`:

```ts
export type PanelState = {
  provider: string;
  model: string;
  window: number;
  summarization: { provider: string; model: string } | null;
  thresholdRatio: number;
  models: Array<{ provider: string; model: string }>;
};

export function buildPanelState(input: {
  provider: string;
  model: string;
  llmContextWindow?: number;
  fixes: FixesSettings;
  catalog: Array<{ provider: string; model: string }>;
}): PanelState {
  const key = modelKey(input.provider, input.model);
  const stored = input.fixes.contextWindows[key];
  return {
    provider: input.provider,
    model: input.model,
    window: stored ?? nearestWindowChoice(input.llmContextWindow ?? 500000),
    summarization: input.fixes.summarization,
    thresholdRatio: input.fixes.thresholdRatio,
    models: input.catalog,
  };
}
```

Test: stored 200000 wins over llm 500000; missing stored snaps 500000 to 500000.

- [ ] **Step 2: Run test to verify it fails, then implement `panel-state.ts` until PASS**

- [ ] **Step 3: Wire `src/index.ts`**

Keep `fillImageInput`. Add:

- `readFixes(settings)` / `writeFixes(settings, next)`
- `installCompactionShrink` already exists — pass summarization from `readFixes`
- `installAutoCompact(ctx)` with global `agent/pre-step`
- `installContextCommand(ctx)` registering `context-compact` when `ctx.get("commands")` exists

Do not add TypeScript types from `@deepseek-ai/dsh-llm` if they are not a dependency; keep `get` + structural types.

- [ ] **Step 4: Run `npm test` and `npm run typecheck`**

Expected: all existing tests pass; new panel-state tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/panel-state.ts test/panel-state.test.ts
git commit -m "feat: host auto-compact and panel state for context controls"
```

---

### Task 6: Client Context chip

**Files:**
- Create: `src/client/index.ts`
- Create: `tsconfig.client.json` if tsdown needs it
- Modify: `package.json` — `"build": "tsc -p tsconfig.json && tsdown"`, export `./client`, `dsh.client.inject` and `platform: "web"`
- Modify: `cordis.patch.yml` — no change required if the same plugin id already loads; client is picked up from package.json `dsh.client`

**Interfaces:**
- Consumes: Host settings namespace `dsh-fixes` (read via client settings if injected; otherwise Host methods). Slot `conversation.input.left` with `{ id: "dsh-fixes-context", order: 0, label: "Context" }`.
- Produces: React `createElement` popover. No JSX. No `import` if the client bundler forbids it — **this is a packaged plugin, tsdown may emit imports**. Follow `@hytime/dsh-thinking-effort` client: TypeScript + React + `createElement` is OK after tsdown.

Client inject (from thinking-effort, minus unused):

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-runtime"
    ],
    "platform": "web"
  }
}
```

UI copy (Chinese first, matching the app):

- Chip: `上下文` showing current window label (`100k` / `200k` / `500k` / `1M`)
- Row 1: `上下文` + four chips
- Row 2: `压缩模型` + `<select>` including option value `""` label `当前对话模型`
- Row 3: `自动压缩` + range input min=20 max=90 step=5 + text `用到 {n}% 时压缩`
- Row 4: button `压缩上下文`
- Disabled button title: `忙碌` or `压缩进行中`
- Error under button: Host/command error string

Current model: from slot standard props `useSession` / conversation snapshot header `config.provider` and `config.model`. If missing, chip disabled.

Window click → Host `settings.update("dsh-fixes", { contextWindows: { ...prev, [key]: choice } })` **and** Host must also mirror to `llm-pi-ai`. Because Client must not write `llm-pi-ai`, window clicks go through a Host-only path:

**Do not update `dsh-fixes` from the Client directly if that skips the llm-pi-ai mirror.** Register Host `settings` watcher: when `dsh-fixes.contextWindows` changes, apply `applyModelWindow` for each key. Then Client **may** `settings.update("dsh-fixes")` for windows, summarizer, and slider. Compact button still uses `/compact` or `context-compact`.

- [ ] **Step 1:** Add `tsdown` + `react` types as devDependencies (same major as thinking-effort: react 18, tsdown ^0.22). Add `src/client/index.ts` that registers the slot with a stub button `上下文` so the Client build has an entry.

- [ ] **Step 2:** Build Client (`npx tsdown`). Confirm `lib/client.js` or `client/client.js` matches `package.json` exports `"./client"`.

- [ ] **Step 3:** Implement popover state from `settings.get("dsh-fixes")` + `settings.watch` / `settings/updated`. Four window buttons call `settings.update`. Select and slider too. Compact button: try `commands` remote if `useChat` exposes `runCommand("compact")`; else dispatch a composer command event if `inputActions` has `submitCommand`. If neither exists after inspecting slot props at implementation time, add Host `harness`-style method only if this packaged plugin has `ctx.server`; otherwise document that Compact runs `session` command `/compact` via `useChat().runCommand?.("compact")` and implement the first API that actually exists on `conversation.input.left` props.

- [ ] **Step 4:** Manual check after `dsh web` restart: chip appears left of the model chip; choosing 200k writes both namespaces; slider persists; Compact on an idle session starts compaction.

- [ ] **Step 5: Commit**

```bash
git add src/client/index.ts package.json package-lock.json tsdown.config.ts tsconfig.client.json README.md README.zh.md
git commit -m "feat: composer Context chip for window, summarizer, slider, compact"
```

---

### Task 7: Docs + regression

**Files:**
- Modify: `README.md`, `README.zh.md`
- Modify: `docs/superpowers/specs/2026-09-20-composer-context-controls-design.md` status to `accepted`

**Interfaces:** none

- [ ] **Step 1:** Document the chip, the four window sizes, global summarizer, slider, compact button, and that the official model popover is unchanged.

- [ ] **Step 2:** Run `npm test && npm run typecheck && npm run build`

Expected: all tests pass, Client+Host build emit.

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh.md docs/superpowers/specs/2026-09-20-composer-context-controls-design.md
git commit -m "docs: describe composer context controls"
```

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Context chip on `conversation.input.left` | 6 |
| 100k/200k/500k/1M global per current model | 1, 2, 5, 6 |
| One global summarizer | 1, 4, 5, 6 |
| Slider 20–90% default 40% | 1, 3, 5, 6 |
| Compact current session only | 5, 6 |
| Do not replace model picker | 6 |
| Mirror into `llm-pi-ai` only for panel-touched models | 2, 5 |
| Shrink + summarizer on compaction stream | 4, 5 |
| pre-step auto compact via agent compaction | 3, 5 |
| Skip busy/lock | 3, 5 |
| Error string not generic compact message | 6 |
| SuperPowers/Matt/创造模式 without preset edits | 5 (agent ctx compaction) |
| Tests listed in spec | 1–5 |

## Placeholder / type check

- Window tokens are `100000 | 200000 | 500000 | 1000000`.
- Settings namespace is `dsh-fixes`.
- `shouldAutoCompact` / `applyModelWindow` / `parseFixesSettings` names are stable across tasks.
- Compact RPC prefers agent-scoped `compaction` + `/compact`; no fake host compaction service.
