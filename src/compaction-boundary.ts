import { sourcePluginName } from "./source-kind.js";

export type ActiveCompactionBoundary = {
  seq: number;
  boundaryId?: string;
  formatVersion?: number;
  coveredStartSeq?: number;
  coveredEndSeq?: number;
  legacy: boolean;
};

type RecordValue = Record<string, unknown>;

type SurfaceEntry = {
  seq: number;
  value: unknown;
  index: number;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalNonEmptyString(value: RecordValue, key: string): boolean {
  return value[key] === undefined || isNonEmptyString(value[key]);
}

function optionalSequence(value: RecordValue, key: string): boolean {
  return value[key] === undefined || isSequence(value[key]);
}

function optionalFormatVersion(value: RecordValue): boolean {
  return value.formatVersion === undefined || typeof value.formatVersion === "number" && Number.isSafeInteger(value.formatVersion) && value.formatVersion > 0;
}

export function isCompactBoundarySource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const plugin = sourcePluginName(value);
  if (plugin === undefined) return false;

  if (plugin === "compact") {
    return isNonEmptyString(value.compactionId);
  }

  if (plugin !== "compact_boundary") return false;
  if (!optionalNonEmptyString(value, "boundaryId")) return false;
  if (!optionalFormatVersion(value)) return false;
  if (!optionalSequence(value, "coveredStartSeq") || !optionalSequence(value, "coveredEndSeq")) return false;
  if (value.coveredStartSeq !== undefined && value.coveredEndSeq !== undefined) {
    if ((value.coveredStartSeq as number) > (value.coveredEndSeq as number)) return false;
  }
  return true;
}

function sourceFromValue(value: unknown): unknown {
  if (!isRecord(value)) return undefined;

  const data = value.data;
  if (isRecord(data)) {
    if (isCompactBoundarySource(data.source)) return data.source;
    if (isRecord(data.message) && isCompactBoundarySource(data.message.source)) return data.message.source;
  }
  if (isCompactBoundarySource(value.source)) return value.source;
  return undefined;
}

function boundaryFromSource(seq: number, source: RecordValue): ActiveCompactionBoundary {
  if (sourcePluginName(source) === "compact") {
    return { seq, legacy: true };
  }

  return {
    seq,
    ...source.boundaryId === undefined ? {} : { boundaryId: source.boundaryId as string },
    ...source.formatVersion === undefined ? {} : { formatVersion: source.formatVersion as number },
    ...source.coveredStartSeq === undefined ? {} : { coveredStartSeq: source.coveredStartSeq as number },
    ...source.coveredEndSeq === undefined ? {} : { coveredEndSeq: source.coveredEndSeq as number },
    legacy: false,
  };
}

function surfaceEntries(session: RecordValue): SurfaceEntry[] | undefined {
  const surface = isRecord(session.surface) ? session.surface : undefined;
  if (!surface || !Array.isArray(surface.nodes)) return undefined;
  const eventAt = typeof session.eventAt === "function" ? session.eventAt : undefined;
  if (eventAt === undefined) return [];

  const entries: SurfaceEntry[] = [];
  for (const [index, value] of surface.nodes.entries()) {
    if (!isSequence(value)) continue;
    let event: unknown;
    try {
      event = eventAt.call(session, value);
    } catch {
      event = undefined;
    }
    entries.push({ seq: value, value: event, index });
  }
  return entries;
}

function messageEntries(session: RecordValue): SurfaceEntry[] | undefined {
  if (!Array.isArray(session.messages)) return undefined;
  const entries: SurfaceEntry[] = [];
  for (const [index, value] of session.messages.entries()) {
    if (!isRecord(value)) continue;
    const seq = isSequence(value.seq) ? value.seq : index;
    entries.push({ seq, value, index });
  }
  return entries;
}

function currentSurfaceEntries(session: RecordValue): SurfaceEntry[] {
  return surfaceEntries(session) ?? messageEntries(session) ?? [];
}

function currentBoundaryFromEntries(entries: readonly SurfaceEntry[]): ActiveCompactionBoundary | undefined {
  let active: ActiveCompactionBoundary | undefined;
  for (const entry of entries) {
    const source = sourceFromValue(entry.value);
    if (isRecord(source)) active = boundaryFromSource(entry.seq, source);
  }
  return active;
}

export function findActiveCompactionBoundary(session: unknown): ActiveCompactionBoundary | undefined {
  if (!isRecord(session)) return undefined;
  return currentBoundaryFromEntries(currentSurfaceEntries(session));
}

function isSystemMessage(value: unknown): boolean {
  return isRecord(value) && value.type === "system/message" || isRecord(value) && value.role === "system";
}

export function surfaceCutBeforeBoundary(session: unknown): number {
  if (!isRecord(session)) return 0;
  const entries = currentSurfaceEntries(session);
  if (entries.length === 0) return 0;

  const systemHead = isSystemMessage(entries[0]?.value) ? 1 : 0;
  const boundary = currentBoundaryFromEntries(entries);
  if (boundary === undefined) return systemHead;

  const boundaryIndex = entries.findIndex((entry) => entry.seq === boundary.seq);
  if (boundaryIndex < 0) return systemHead;
  return Math.max(systemHead, boundaryIndex);
}

