# dsh-fixes

A DeepSeek Harness **web profile** plugin. It restores capabilities that third-party gateways omit, and adds context controls next to the composer.

It writes host-process settings, so **every session** on that profile picks them up — not only the conversation that installed it.

- [中文说明](./README.zh.md)

## What it does

| Feature | Behavior |
| --- | --- |
| Image input | Declares `text` + `image` on every third-party `llm-pi-ai` provider that left input empty or text-only |
| Context windows | Fills official `contextWindow` / `maxTokens` for known models; other undeclared models get `500000`; explicit numbers are left alone |
| Context chip | Window, summarizer, reserve-based auto-compact, boundary preview, and one-click compact for the current session, next to the official model picker |

Uninstalling the plugin does **not** roll back values already written into `llm-pi-ai`.

## Install

From this directory:

```sh
npm install
npm run build
dsh plugin --profile web add .
```

Restart `dsh web` after the first install. Later source changes need `npm run build` and a profile reload.

Development:

```sh
npm test
npm run typecheck
```

Repository: https://github.com/Meteor-system/dsh-fixes

## Context chip

The chip sits on the **right** of the composer tool row, immediately left of the official model picker. It shows only the window (`256k`); hover for `上下文 256k`, so a long model name is less likely to wrap. The official model/effort popover is unchanged.

Inside the popover, top to bottom:

1. **Window** — `128k` / `256k` / `392k` / `512k` / `1M`. Default: the **current chat model, globally** (also mirrored into `llm-pi-ai`). Check **this session only** to override the current conversation without touching the catalog. Choosing `1M` warns that some models bill extra at that length (no per-model price lookup).
2. **Summarizer** — models already in `llm-pi-ai`, grouped by provider. Empty = current chat model. Compaction summaries go to this cheaper model.
3. **Auto-compact** — global toggle, with an optional this-session override. The panel shows the computed token threshold: `window - 20k summary reserve - 13k tool-result reserve`, floored at half the window. For a 272k window that is 239k; for small windows the half-window floor prevents immediate repeated compaction. The isolate engine's pressure trigger is suppressed so this formula owns normal auto-compact; provider overflow can still compact as a recovery path.
4. **Preview** — `将压缩 N 条较早消息`. Click to list titles/excerpts from the model-visible surface after the active compaction boundary. Legacy `compact` checkpoints and the new `compact_boundary` marker are recognized; a post-compaction workspace rehydration appears as `上下文快照`. Shows `暂不可预览` when the session snapshot is unavailable.
5. **Compact** — this session only. Bright blue fill, darkens while pressed. Dims and shows `压缩中…` while busy. A successful compaction appends one snapshot with recent files, current todos, and invoked skill bodies when they fit the budget.

Changing the window does **not** shorten history that is already too long. Overflowed sessions must compact first. The first summarizer request keeps its complete selected history, including tools and images; if it fails before producing output because the prompt is too long, the plugin removes complete oldest turns and retries once. An original request that overflows follows the same boundary path at most once per turn.

The active boundary is one durable checkpoint message shared by automatic compaction, `/compact`, the preview, and the next model request. Old sessions without that marker remain readable. After a successful boundary, the plugin makes a best-effort snapshot of up to five recently touched files, the latest todo projection, and persisted skill invocation bodies within a 50k-token budget.

## Other fixes

**Images.** Custom OpenAI-compatible gateways often list models with `input: []`. Harness then falls back to `defaultInput: [text]`, and tools like `read_image` refuse:

```
cannot read "...png" as an image: model "grok-4.6" does not declare image input
```

The plugin watches `llm-pi-ai` and, for every third-party provider, sets `defaultInput` to `[text, image]` when image is missing, and writes `input: [text, image]` on every `models` / `modelOverrides` entry that does not already declare image.

**Windows.** grok-4.6, for example, gets the official 500k. Models never touched in the Context panel keep their catalog number (Kimi 128k / 256k / 1M, and so on).

**Search.** Free web search has moved to the separate [`dsh-web-search`](../dsh-web-search) bundle, with its own switch under General settings. Install both bundles to keep search working; this plugin no longer registers a search provider.

## Candidate upstream

The context chip, the compaction boundary, rehydration, and the compaction retry wrappers patch Harness internals (`llm.stream`, `sessions.get`, `agents.get`, and the compaction service). They are the strongest candidates to move into Harness core. Until then they stay here, and a Harness upgrade can break them.

## Settings

Plugin-owned namespace `dsh-fixes`, not mixed into compaction-basic YAML:

```yaml
dsh-fixes:
  contextWindows:
    routincodex/grok-4.6: 512000
  summarization:
    provider: routincodex
    model: gpt-5.4-mini
  compactionReserves:
    routincodex/grok-4.6:
      summaryOutputTokens: 20000
      toolResultTokens: 13000
  autoCompactEnabled: true
  sessionOverrides:
    <session-id>:
      window: 128000
      autoCompactEnabled: false
```

| Field | Meaning |
| --- | --- |
| `contextWindows` | `provider/model` → 128000 / 256000 / 392000 / 512000 / 1000000 |
| `summarization` | Global summarizer; omit to use the current chat model |
| `compactionReserves` | Optional `provider/model` reserve overrides; defaults are 20000 summary-output tokens and 13000 tool-result tokens |
| `autoCompactEnabled` | Global auto-compact, default `true` |
| `sessionOverrides` | Per-session window and/or auto-compact |

A global window change also writes the same number onto the matching `llm-pi-ai` model. A session override does not.

## Limits

- The panel does not probe the gateway's true limit. A chosen window larger than the gateway can still overflow.
- A this-session window affects this plugin's reserve-based auto-compact threshold; the gateway's true limit is still unknown.
- If the summarizer is missing credentials, compact fails, history is unchanged, and the panel shows the host error. A failed file read during rehydration is skipped without cancelling compaction.
- Manual compact is unavailable while the agent is running or a compaction lock is held.
- The 1M surcharge note is a generic hint, not a per-model price.
