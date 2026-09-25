# Context Continuity

This context defines the language for preserving useful agent context when a long session is compacted.

## Compaction

**Active compaction boundary**:
The single current point at which older conversation history stops being model-visible and a durable summary becomes the model-visible starting point.
_Avoid_: checkpoint table, summary marker, compression line

**Boundary message**:
The durable model-visible message that carries the fixed-section summary and identifies the active compaction boundary.
_Avoid_: checkpoint, digest, replacement shell

**Model-visible surface**:
The ordered conversation content that request assembly sends to the model after applying the active compaction boundary.
_Avoid_: raw session log, transcript table

**Rehydration snapshot**:
Current workspace state appended after a boundary, including recently touched file contents and the task or skill context needed to continue work.
_Avoid_: mechanical compression, stale file cache

**No-progress compaction**:
A compaction that completes its semantic boundary update without reducing the measured request enough to cross the current pressure threshold; it is allowed once and then stops for the current cycle.
_Avoid_: drained run, failed compression
