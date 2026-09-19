# dsh-fixes

Host-side compatibility fixes for DeepSeek Harness.

The plugin is installed in the **web profile**. It writes `llm-pi-ai` settings on
the host process, so **every session** on that profile picks up the same model
capabilities. It is not limited to the conversation that installed it.

Custom OpenAI-compatible gateways often list models with an empty `input` array.
Harness then falls back to `defaultInput: [text]`, and tools like `read_image`
refuse:

```
cannot read "...png" as an image: model "grok-4.6" does not declare image input
```

This plugin watches `llm-pi-ai` settings and, for **every third-party provider**:

- sets `defaultInput` to `[text, image]` when image is missing
- writes `input: [text, image]` on every model and `modelOverrides` entry that
  does not already declare image

Uninstalling the plugin does not roll the written settings back.

## Install

From this directory:

```sh
dsh plugin --profile web add .
```

Restart `dsh web` after the first install. Later source changes need a rebuild
(`npm run build`) and a profile reload.

## Fixes

| Scope | Change |
| --- | --- |
| All `llm-pi-ai` providers | declare `text` + `image` when the catalog left input empty or text-only |
| Known models (e.g. grok-4.6) | fill official `contextWindow` / `maxTokens` (500k for grok-4.6) |
| Other undeclared third-party models | fill `500000`; leave explicit windows (Kimi 128k/256k/1M) alone |
| `web_search` | register a free search backend and switch `searchProvider` from `deepseek-official` to `duckduckgo` (no DeepSeek key) |
| Auto-compact | Context slider (20–90%, default 40%); shipped Agent presets are not edited |
| `/compact` summarizer | strip images and truncate huge tool results so overflowed sessions can still summarize |

Search tries DuckDuckGo's HTML results page first, then falls back to Bing if DDG is unreachable or challenged. There is no official search API. `web_fetch` still uses the existing `http` provider.

## Context controls

A **Context** chip sits on the composer, immediately left of the official model chip. The official model/effort popover is unchanged.

Open the chip to:

- Set a working window for the **current chat model, globally**: `100k` / `200k` / `500k` / `1M`. Every session that uses that model picks up the same window. Models you never touch here keep their existing `llm-pi-ai` window. Choosing `1M` shows a warning that some models bill extra at that length.
- Pick one **global summarizer** (`Compact with`) from models already in `llm-pi-ai`. Empty means “use the current chat model”. Compaction summaries go to that cheaper model instead of the chat model.
- Slide **Auto-compact** between 20% and 90% of that model's window (default 40%). The label is like `Compact at 40% of window`.
- Press **Compact** to compact **this session only**. The button is disabled while the agent is running or a compaction lock is held.

A slider above 80% cannot delay the isolate engine's own auto-compact, which still fires at 80%.
