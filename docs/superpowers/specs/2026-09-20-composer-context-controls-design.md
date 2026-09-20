# Composer context controls

Date: 2026-09-20  
Status: accepted  
Project: `dsh-fixes`

## Problem

Third-party models in `llm-pi-ai` often have the wrong `contextWindow`, so overflow and compaction fire at the wrong time. Users currently have no control next to the composer model chip for:

- declaring a working window (128k / 256k / 392k / 512k / 1M)
- picking a cheaper model for compaction summaries
- choosing when auto-compaction runs
- compacting the current session without typing `/compact`

The shipped model/effort popover (`conversation.input.model`) has no inner Slot. Replacing it would shadow official UI.

## Goals

- Add a composer-adjacent **Context** control that does not replace the official model picker.
- Window choice applies to the **current chat model, globally** (all sessions using that model).
- Auto-compaction threshold is a **percentage of that model's window**.
- Summarization uses **one global cheap model**.
- Compact button affects **only the current session**.
- SuperPowers, Matt, 创造模式, and old sessions all honor the slider and button without editing shipped presets.

## Non-goals

- Detecting a gateway's true context limit.
- Per-session window overrides.
- Per-chat-model summarizer pairing.
- Replacing `conversation.input.model`.
- Changing Kimi (or any model) windows the user has not touched in this panel.

## UI

Place a **Context** chip on `conversation.input.left`, immediately beside the official model chip. Same visual language as `grok-4.6 Max`.

Popover, top to bottom:

1. **Context** — exclusive choices `128k` / `256k` / `392k` / `512k` / `1M`. Maps to 128000 / 256000 / 392000 / 512000 / 1000000 tokens. Highlights the stored window for the current `provider/model`.
2. **Compact with** — dropdown of models already in `llm-pi-ai`. Empty means “use the current chat model”. Stores one global `{ provider, model }`.
3. **Auto-compact** — slider 20%–90%, default 40%, labeled like `Compact at 40% of window`.
4. **Compact** — button. Disabled while the agent is running or a compaction lock is held. On failure, show the underlying error string, not only “could not produce a useful summary”.

The official effort popover is unchanged.

## Settings

New namespace `dsh-fixes` (plugin-owned), not mixed into compaction-basic YAML:

```yaml
dsh-fixes:
  contextWindows:
    routincodex/grok-4.6: 500000
  summarization:
    provider: routincodex
    model: gpt-5.4-mini
  thresholdRatio: 0.4
```

`thresholdRatio` is stored as 0.20–0.90. Missing section uses 0.40.

Changing a window also writes `llm-pi-ai.providers.<id>.models[].contextWindow` for that exact model so metering, overflow classification, and `read_image` see the same number.

## Host behavior

On apply:

- Watch `dsh-fixes` and `llm-pi-ai`.
- Keep wrapping `llm.stream` for `purpose === "compaction"`: strip images, truncate huge text, omit tools, and if `summarization` is set, override `provider`/`model` on that call only.
- Listen to `agent/pre-step` with `{ global: true }`. If estimated tokens ≥ `contextWindow * thresholdRatio` and compaction is available on that agent, run one compact. Skip when the agent is busy or a compaction lock is active.
- Expose JSON methods for the Client: read state, set window for current model, set summarizer, set threshold, compact-now.

Compact-now runs manual compaction on the calling session only.

## Client behavior

Register on `conversation.input.left`. Read session `provider`/`model` from the conversation snapshot. Call Host methods; do not write `settings.yaml` from the browser.

## Failure cases

| Case | Behavior |
| --- | --- |
| Gateway smaller than chosen window | Overflow can still happen; panel does not probe the gateway |
| Summarizer missing credentials | Compact fails; history unchanged; show Host error |
| Slider fires during a turn | Skip this pre-step |
| Compact while running / locked | Button disabled; message names busy/lock |
| Summarizer overflows | Existing shrink applies; if still failing, show cause and suggest a new session |
| User switches chat model | Window chips follow that model's stored value; summarizer and slider stay global |

## Testing

- Window write updates `dsh-fixes` and the matching `llm-pi-ai` model only.
- Models with an explicit window the user never set in this panel are left alone.
- Compaction stream uses the configured summarizer and shrinks images/long text.
- Pre-step compact is skipped when below threshold, busy, or locked.
- Compact-now is session-scoped.

## Deferred extensions

Recorded 2026-03-22.

- Show used tokens / window on the Context chip. **Skipped** — DSH already shows used tokens.
- Toggle to disable auto-compact entirely. **Done** — global default plus this-session override; isolate `pressure` is suppressed.
- Per-session window (currently global per model). **Done** — chips stay global; “仅当前会话” writes `sessionOverrides` without mirroring `llm-pi-ai`. Official meter still follows the catalog/global window.
- Preview which messages compact would drop. **Done** — persistent count line; click to list; compact stays one click.

## Implementation home

All of this stays in `dsh-fixes` (Host + Client). No shipped preset files. No replace of `conversation.input.model`.
