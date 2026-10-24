/** The lists of a plan file and what their elements are (`docs/plan-format.md`). */
const LISTS = [
  ["rooms", "room"],
  ["partitions", "wall"],
  ["doors", "door"],
  ["windows", "window"],
  ["items", "furniture"],
] as const;

/** An element of a plan file: its id, what it is, and its fields. */
export interface PlanFileElement {
  id: string;
  type: (typeof LISTS)[number][1];
  fields: Record<string, unknown>;
}

/** Every element of a plan file with an id, rooms first. */
export function planElements(plan: unknown): PlanFileElement[] {
  const root = plan as Record<string, unknown> | null | undefined;
  if (!root || typeof root !== "object") return [];
  return LISTS.flatMap(([key, type]) => {
    const list = root[key];
    if (!Array.isArray(list)) return [];
    return (list as unknown[]).flatMap((raw) => {
      const fields = raw as Record<string, unknown> | null;
      if (!fields || typeof fields.id !== "string") return [];
      return [{ id: fields.id, type, fields }];
    });
  });
}
