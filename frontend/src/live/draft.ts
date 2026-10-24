/**
 * The drafts of edit mode (the edit overlay) and of the plan editor (the plan drawn), not saved
 * yet, kept in this browser so that a closed tab or a lost connection does not lose the work. A
 * draft belongs to the stored revision it started from; once the plan has been saved again (here
 * or elsewhere) it is stale and forgotten. It stays on this device: nothing is sent anywhere.
 */

const KEY = "domotwin-edit-draft";
const PLAN_KEY = "domotwin-plan-draft";

export interface Draft {
  /** The stored revision the edits started from. */
  revision: number;
  layout: Record<string, unknown>;
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Storage disabled (private browsing, policies).
    return undefined;
  }
}

/** The plan editor's draft. */
export interface PlanDraft {
  /** The stored revision the drawing started from. */
  revision: number;
  plan: Record<string, unknown>;
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

/** The draft for `revision`, if one was kept (a stale one is forgotten). */
export function readDraft(revision: number): Draft | undefined {
  const layout = read(KEY, "layout", revision);
  return layout ? { revision, layout } : undefined;
}

/** Keeps the overlay not saved yet. */
export function writeDraft(draft: Draft): void {
  write(KEY, draft);
}

export function clearDraft(): void {
  clear(KEY);
}

/** The plan editor's draft for `revision`, if one was kept (a stale one is forgotten). */
export function readPlanDraft(revision: number): PlanDraft | undefined {
  const plan = read(PLAN_KEY, "plan", revision);
  return plan ? { revision, plan } : undefined;
}

/** Keeps the plan drawn and not saved yet. */
export function writePlanDraft(draft: PlanDraft): void {
  write(PLAN_KEY, draft);
}

export function clearPlanDraft(): void {
  clear(PLAN_KEY);
}
