# dsh-fixes

A DeepSeek Harness **web profile** plugin. It restores capabilities that third-party gateways omit, and adds context controls next to the composer.

It writes host-process settings, so **every session** on that profile picks them up — not only the conversation that installed it.

- [中文说明](./README.zh.md)

## What it does

| Feature | Behavior |
| --- | --- |
| Image input | Declares `text` + `image` on every third-party `llm-pi-ai` provider that left input empty or text-only |
| Context windows | Fills official `contextWindow` / `maxTokens` for known models; other undeclared models get `500000`; explicit numbers are left alone |
| Free search | Routes `web_search` through DuckDuckGo (Bing HTML fallback) so no DeepSeek key is required |
| Context chip | Window, summarizer, auto-compact, and one-click compact for the current session, next to the official model picker |

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
3. **Auto-compact** — global toggle, with an optional this-session override. Slider is 20%–90% of the window (default 40%). The slider greys out when auto-compact is off. The isolate engine's own 80% pressure trigger is suppressed so this slider owns auto-compact; provider overflow can still compact as a last resort.
4. **Preview** — `将压缩 N 条较早消息`. Click to list titles/excerpts that `/compact` would replace. Shows `暂不可预览` when the session snapshot is unavailable.
5. **Compact** — this session only. Bright blue fill, darkens while pressed. Dims and shows `压缩中…` while busy.

Changing the window does **not** shorten history that is already too long. Overflowed sessions must compact first.

## Other fixes

**Images.** Custom OpenAI-compatible gateways often list models with `input: []`. Harness then falls back to `defaultInput: [text]`, and tools like `read_image` refuse:

```
cannot read "...png" as an image: model "grok-4.6" does not declare image input
```

The plugin watches `llm-pi-ai` and, for every third-party provider, sets `defaultInput` to `[text, image]` when image is missing, and writes `input: [text, image]` on every `models` / `modelOverrides` entry that does not already declare image.

**Windows.** grok-4.6, for example, gets the official 500k. Models never touched in the Context panel keep their catalog number (Kimi 128k / 256k / 1M, and so on).

**Search.** DuckDuckGo HTML results first; Bing web search if DDG is unreachable or challenged. There is no official search API. `web_fetch` still uses the existing `http` provider.

## Settings

Plugin-owned namespace `dsh-fixes`, not mixed into compaction-basic YAML:

```yaml
dsh-fixes:
  contextWindows:
    routincodex/grok-4.6: 512000
  summarization:
    provider: routincodex
    model: gpt-5.4-mini
  thresholdRatio: 0.4
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
| `thresholdRatio` | Auto-compact ratio, 0.20–0.90, default 0.40 |
| `autoCompactEnabled` | Global auto-compact, default `true` |
| `sessionOverrides` | Per-session window and/or auto-compact |

A global window change also writes the same number onto the matching `llm-pi-ai` model. A session override does not.

## Limits

- The panel does not probe the gateway's true limit. A chosen window larger than the gateway can still overflow.
- A this-session window only affects this plugin's auto-compact threshold. The official token meter still follows the catalog / global window.
- If the summarizer is missing credentials, compact fails, history is unchanged, and the panel shows the host error.
- Manual compact is unavailable while the agent is running or a compaction lock is held.
- The 1M surcharge note is a generic hint, not a per-model price.
