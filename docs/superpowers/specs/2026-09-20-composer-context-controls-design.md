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
- Auto-compaction threshold is computed from the model window minus a summary-output reserve and one tool-result reserve, with a half-window floor.
- Summarization uses **one global cheap model** and keeps the full selected input on the first attempt.
- Compact button affects **only the current session** and appends a durable rehydration snapshot after success.
- SuperPowers, Matt, 创造模式, and old sessions all honor the computed threshold, shared boundary, and button without editing shipped presets.

## Non-goals

- Detecting a gateway's true context limit.
- Per-session window overrides.
- Per-chat-model summarizer pairing.
- Replacing `conversation.input.model`.
- Changing Kimi (or any model) windows the user has not touched in this panel.

## UI

Place a **Context** chip on `conversation.input.right`, immediately beside the official model chip. Same visual language as `grok-4.6 Max`.

Popover, top to bottom:

1. **Context** — exclusive choices `128k` / `256k` / `392k` / `512k` / `1M`. Maps to 128000 / 256000 / 392000 / 512000 / 1000000 tokens. Highlights the stored window for the current `provider/model`.
2. **Compact with** — dropdown of models already in `llm-pi-ai`. Empty means “use the current chat model”. Stores one global `{ provider, model }`.
3. **Auto-compact** — toggle with an optional per-session override. Show the computed token threshold and reserves, such as `约 239k 时压缩（预留摘要 20k + 工具结果 13k）`.
4. **Preview** — show the current model-visible surface after the active legacy/new compaction boundary; label the rehydration snapshot separately.
5. **Compact** — button. Disabled while the agent is running or a compaction lock is held. On failure, show the underlying error string, not only “could not produce a useful summary”.

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
  compactionReserves:
    routincodex/grok-4.6:
      summaryOutputTokens: 20000
      toolResultTokens: 13000
```

The computed threshold is `max(floor(contextWindow / 2), contextWindow - summaryOutputTokens - toolResultTokens)`. Defaults are 20000 summary-output tokens and 13000 tool-result tokens; route entries may override either field. Legacy `thresholdRatio` values are ignored.

Changing a window also writes `llm-pi-ai.providers.<id>.models[].contextWindow` for that exact model so metering, overflow classification, and `read_image` see the same number.

## Host behavior

On apply:

- Watch `dsh-fixes` and `llm-pi-ai`.
- Keep the first `purpose === "compaction"` request complete. If it fails before visible output with a classified prompt-overflow, remove complete oldest turns while preserving tool pairing and retry that summary request once. If `summarization` is set, override `provider`/`model` on that call only.
- Listen to `agent/pre-step` with `{ global: true }`. If estimated tokens reach the reserve-based threshold and compaction is available on that agent, run one compact. Skip when the agent is busy or a compaction lock is active.
- Register `agent/request-error` recovery for one context-overflow retry per agent/turn, only after a committed compaction with progress. A valid but non-shrinking summary ends the cycle.
- Use one post-compaction hook for `compactIfNeeded` and `compactNow`: append a snapshot-style `user/message` with current touched files, todo projection, and persisted skill bodies, then flush best-effort.
- Expose the settings scope to the Client: read state, set window for current model, set summarizer, set auto-compact, and compact-now.

Compact-now runs manual compaction on the calling session only.

## Client behavior

Register on `conversation.input.right`. Read session `provider`/`model` from the conversation snapshot. Show the computed reserve threshold and the shared-boundary preview. Call the settings scope; do not write `settings.yaml` from the browser.

## Failure cases

| Case | Behavior |
| --- | --- |
| Gateway smaller than chosen window | Overflow can still happen; panel does not probe the gateway |
| Summarizer missing credentials | Compact fails; history unchanged; show Host error |
| Auto-compact fires during a turn | Skip this pre-step; request overflow recovery remains one-shot per turn |
| Compact while running / locked | Button disabled; message names busy/lock |
| Summarizer overflows before output | Keep the first full request; remove complete oldest turns and retry once; partial output or unrelated failures remain terminal |
| Rehydration file is missing or unreadable | Skip that item and keep the snapshot best-effort |
| User switches chat model | Window chips follow that model's stored value; summarizer and reserve overrides stay global by route |

## Testing

- Window write updates `dsh-fixes` and the matching `llm-pi-ai` model only.
- Models with an explicit window the user never set in this panel are left alone.
- Compaction stream keeps the first full request and retries only a zero-output prompt-overflow after whole-turn trimming.
- The threshold formula covers 272k→239k and the half-window floor for small windows.
- Boundary preview cuts both legacy and new markers at the same surface point and shows empty sessions safely.
- Pre-step compact is skipped when below threshold, busy, or locked; request recovery is one-shot per turn.
- Compact-now is session-scoped and shares the post-compaction rehydration hook.

## Deferred extensions

Recorded 2026-03-22.

- Show used tokens / window on the Context chip. **Skipped** — DSH already shows used tokens.
- Toggle to disable auto-compact entirely. **Done** — global default plus this-session override; isolate `pressure` is suppressed.
- Per-session window (currently global per model). **Done** — chips stay global; “仅当前会话” writes `sessionOverrides` without mirroring `llm-pi-ai`.
- Reserve overrides by route. **Done** — `compactionReserves` can replace either reserve without restoring the removed ratio slider.
- Preview which messages compact would drop. **Done** — persistent count line; click to list; the same active boundary is used by host and client.
- Workspace rehydration after compaction. **Done** — current file reads, todos, and invoked skill bodies share a capped snapshot budget.

## Implementation home

All of this stays in `dsh-fixes` (Host + Client). No shipped preset files. No replace of `conversation.input.model`.
