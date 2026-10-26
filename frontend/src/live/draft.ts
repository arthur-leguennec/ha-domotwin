/**
 * The drafts of edit mode (the edit overlay) and of the plan editor (the plan drawn), not saved
 * yet, kept in this browser so that a closed tab or a lost connection does not lose the work. A
 * draft belongs to the stored revision it started from; once the plan has been saved again (here
 * or elsewhere) it is stale and forgotten. It stays on this device: nothing is sent anywhere.
 */

const KEY = "domotwin-edit-draft";
const PLAN_KEY = "domotwin-plan-draft";

/** Each storey's drafts are its own ("": a new storey); the bare keys are from before storeys. */
function keyOf(base: string, storey: string): string {
  return `${base}:${storey}`;
}

export interface Draft {
  /** The stored revision the edits started from. */
  revision: number;
  /** The storey edited. */
  storey: string;
  layout: Record<string, unknown>;
}

/** The plan editor's draft. */
export interface PlanDraft {
  /** The stored revision the drawing started from. */
  revision: number;
  /** The storey it was drawn for ("": a new storey). */
  storey: string;
  plan: Record<string, unknown>;
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Storage disabled (private browsing, policies).
    return undefined;
  }
}

/** The object kept under `key` as `field` for `revision`; a stale or broken one is forgotten. */
function read(key: string, field: string, revision: number): Record<string, unknown> | undefined {
  const store = storage();
  try {
    const text = store?.getItem(key);
    if (!text) return undefined;
    const draft = JSON.parse(text) as Record<string, unknown>;
    const value = draft[field];
    if (
      draft.revision === revision &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }
    store?.removeItem(key);
  } catch {
    store?.removeItem(key);
  }
  return undefined;
}

function write(key: string, draft: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(draft));
  } catch {
    // Full or disabled: the draft is a convenience.
  }
}

function clear(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Disabled.
  }
}

/** Edit mode's draft of `storey` for `revision`, if one was kept (a stale one is forgotten). */
export function readDraft(revision: number, storey: string): Draft | undefined {
  // A draft from before storeys cannot tell which storey it was for.
  clear(KEY);
  const layout = read(keyOf(KEY, storey), "layout", revision);
  return layout ? { revision, storey, layout } : undefined;
}

/** Keeps the overlay not saved yet. */
export function writeDraft(draft: Draft): void {
  write(keyOf(KEY, draft.storey), { revision: draft.revision, layout: draft.layout });
}

export function clearDraft(storey: string): void {
  clear(keyOf(KEY, storey));
}

/** The plan editor's draft of `storey` for `revision`, if one was kept (a stale one is forgotten). */
export function readPlanDraft(revision: number, storey: string): PlanDraft | undefined {
  clear(PLAN_KEY);
  const plan = read(keyOf(PLAN_KEY, storey), "plan", revision);
  return plan ? { revision, storey, plan } : undefined;
}

/** Keeps the plan drawn and not saved yet. */
export function writePlanDraft(draft: PlanDraft): void {
  write(keyOf(PLAN_KEY, draft.storey), { revision: draft.revision, plan: draft.plan });
}

export function clearPlanDraft(storey: string): void {
  clear(keyOf(PLAN_KEY, storey));
}

/** A tip once read is not shown again on this device (D-047): whether `tip` was. */
export function tipRead(tip: string): boolean {
  try {
    return storage()?.getItem(`domotwin-tip-${tip}`) === "read";
  } catch {
    return false;
  }
}

/** Remembers on this device that `tip` was read. */
export function readTip(tip: string): void {
  try {
    storage()?.setItem(`domotwin-tip-${tip}`, "read");
  } catch {
    // Storage full or disabled: the tip may come back.
  }
}
