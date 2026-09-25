---
status: accepted
---

# Use one authoritative compaction boundary

The durable boundary message is the single semantic source for where older conversation stops being model-visible. Automatic compaction, manual `/compact`, the UI preview, and post-compaction rehydration all use the same active boundary; repeated compaction selects the newest valid boundary while preserving the system head. Internal lifecycle records remain responsible for locking, failure recovery, and persistence, and old session records remain readable while new compactions and snapshots carry structured plugin provenance.

The implementation evidence gate inspected the current request path: `agent-loop` assembles `session.deriveMessages()`, and `dsh-llm` applies only file/image projections before the adapter call. The plugin therefore keeps one boundary reader and does not add a core protocol rewrite.

## Consequences

This prevents the request and the UI from independently reconstructing different cuts. The boundary message carries a small structured provenance payload, while legacy lifecycle records continue to provide locking, failure recovery, and persistence. A successful boundary also admits one snapshot-style rehydration message, so current workspace context enters the same model-visible surface after the cut.
