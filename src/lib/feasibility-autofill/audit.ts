/**
 * Audit + versioning (F5-2) — every mutation is recorded (spec §9).
 *
 * Pure builders for AuditLog rows and object diffs; the server action persists the
 * returned row and bumps the answer's `version`. Keeping the diff logic here (not in the
 * route) means the audit trail is deterministic and unit-tested. `at` is injected, never
 * clock-read, so a replayed action produces an identical row.
 */

/** A field-level change: value before → after. */
export interface FieldDiff {
  from: unknown;
  to: unknown;
}

/** Shallow diff of two records — only changed keys appear. */
export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, FieldDiff> {
  const out: Record<string, FieldDiff> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      out[k] = { from: before[k], to: after[k] };
    }
  }
  return out;
}

export interface AuditEntry {
  siteId: string | null;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  /** JSON-serialized diff (matches the AuditLog.diff column). */
  diff: string;
  at: string;
}

/** Build an audit row from a before/after pair. `at` is an injected ISO timestamp. */
export function makeAuditEntry(params: {
  siteId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: string;
}): AuditEntry {
  const diff =
    params.before && params.after ? diffObjects(params.before, params.after) : {};
  return {
    siteId: params.siteId ?? null,
    entity: params.entity,
    entityId: params.entityId,
    action: params.action,
    actor: params.actor,
    diff: JSON.stringify(diff),
    at: params.at,
  };
}

/** Next version number for an answer edit (monotonic, never reused). */
export function nextVersion(current: number): number {
  return current + 1;
}
