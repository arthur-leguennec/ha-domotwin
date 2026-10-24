/**
 * The edit mode draft: the edit overlay not saved yet, kept in this browser so that a closed tab
 * or a lost connection does not lose the work. It belongs to the stored revision it started from;
 * once the plan has been saved again (here or elsewhere) it is stale and forgotten. It stays on
 * this device: nothing is sent anywhere.
 */

const KEY = "domotwin-edit-draft";

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

/** The draft for `revision`, if one was kept (a stale one is forgotten). */
export function readDraft(revision: number): Draft | undefined {
  const store = storage();
  try {
    const text = store?.getItem(KEY);
    if (!text) return undefined;
    const draft = JSON.parse(text) as { revision?: unknown; layout?: unknown };
    const layout = draft.layout;
    if (
      draft.revision === revision &&
      typeof layout === "object" &&
      layout !== null &&
      !Array.isArray(layout)
    ) {
      return { revision, layout: layout as Record<string, unknown> };
    }
    store?.removeItem(KEY);
  } catch {
    store?.removeItem(KEY);
  }
  return undefined;
}

/** Keeps the overlay not saved yet. */
export function writeDraft(draft: Draft): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Full or disabled: the draft is a convenience.
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Disabled.
  }
}
