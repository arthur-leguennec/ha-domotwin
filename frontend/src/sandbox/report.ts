/**
 * What the sandbox's day says (D-057): what each automation did and when, what never ran and
 * why, the automations working against each other, and what could not be played.
 */
import type { Cause, DayPlayed, Entry, FiredBy } from "./engine";

/** Two automations setting one entity differently within this long work against each other. */
export const CONFLICT_MS = 2 * 60_000;
/** An entity set this many times within the window by automations goes back and forth. */
export const FLAP_CHANGES = 6;
export const FLAP_MS = 10 * 60_000;

export interface CallDone {
  at: number;
  service: string;
  changed: string[];
}

export interface SaidDone {
  at: number;
  service: string;
  message?: string;
}

/** One run of an automation or a script: what set it off, what it did, how it ended. */
export interface RunReport {
  run: number;
  at: number;
  by: FiredBy;
  calls: CallDone[];
  said: SaidDone[];
  end?: { at: number; why: "done" | "condition" | "stop" | "error" | "restart" | "off" };
}

export interface OwnerReport {
  id: string;
  kind: "automation" | "script";
  runs: RunReport[];
  /** Set off but stopped by its conditions, or not started while it ran already. */
  stoppedByConditions: number;
  busy: number;
  notPlayed: { reason: string; detail: string }[];
  looping: boolean;
}

/** Two automations working against each other on one entity. */
export interface Conflict {
  entity: string;
  at: number;
  first: { owner: string; state: string; at: number };
  second: { owner: string; state: string; at: number };
}

/** An entity set back and forth by automations. */
export interface Flapping {
  entity: string;
  at: number;
  changes: number;
  owners: string[];
}

export interface DayReport {
  owners: OwnerReport[];
  /** The automations that never ran, set off or not. */
  neverRan: string[];
  conflicts: Conflict[];
  flapping: Flapping[];
  cutShort?: number;
}

function ownerOf(cause: Cause): string | undefined {
  return cause.kind === "automation" || cause.kind === "script" ? cause.id : undefined;
}

/** The report of a day played, for `automations` (their entity ids) and `scripts`. */
export function reportOf(
  day: DayPlayed,
  automations: readonly string[],
  scripts: readonly string[],
): DayReport {
  const owners = new Map<string, OwnerReport>();
  const ownerReport = (id: string): OwnerReport => {
    let found = owners.get(id);
    if (!found) {
      found = {
        id,
        kind: id.startsWith("script.") ? "script" : "automation",
        runs: [],
        stoppedByConditions: 0,
        busy: 0,
        notPlayed: [],
        looping: false,
      };
      owners.set(id, found);
    }
    return found;
  };
  for (const id of automations) ownerReport(id);
  for (const id of scripts) ownerReport(id);
  const runs = new Map<string, RunReport>();
  const runOf = (entry: Entry & { run?: number }): RunReport | undefined =>
    entry.run === undefined ? undefined : runs.get(`${entry.owner}|${entry.run}`);
  for (const entry of day.log) {
    const owner = ownerReport(entry.owner);
    switch (entry.kind) {
      case "fired":
        if (entry.outcome === "ran" && entry.run !== undefined) {
          const run: RunReport = {
            run: entry.run,
            at: entry.at,
            by: entry.by,
            calls: [],
            said: [],
          };
          owner.runs.push(run);
          runs.set(`${entry.owner}|${entry.run}`, run);
        } else if (entry.outcome === "condition") owner.stoppedByConditions += 1;
        else if (entry.outcome === "busy") owner.busy += 1;
        break;
      case "call":
        runOf(entry)?.calls.push({ at: entry.at, service: entry.service, changed: entry.changed });
        break;
      case "said":
        runOf(entry)?.said.push({
          at: entry.at,
          service: entry.service,
          ...(entry.message !== undefined ? { message: entry.message } : {}),
        });
        break;
      case "done":
      case "stopped": {
        const run = runOf(entry);
        if (run && !run.end) {
          run.end = { at: entry.at, why: entry.kind === "done" ? "done" : entry.why };
        }
        break;
      }
      case "unplayable":
        if (!owner.notPlayed.some((n) => n.reason === entry.reason && n.detail === entry.detail)) {
          owner.notPlayed.push({ reason: entry.reason, detail: entry.detail });
        }
        break;
      case "loop":
        owner.looping = true;
        break;
    }
  }
  const neverRan = automations.filter((id) => (owners.get(id)?.runs.length ?? 0) === 0);
  return {
    owners: [...owners.values()],
    neverRan,
    conflicts: conflictsOf(day),
    flapping: flappingOf(day),
    ...(day.cutShort !== undefined ? { cutShort: day.cutShort } : {}),
  };
}

/** Changes of state (not of attributes alone) made by automations and scripts. */
function stateChanges(
  day: DayPlayed,
): { at: number; entity: string; state: string; owner: string }[] {
  const found: { at: number; entity: string; state: string; owner: string }[] = [];
  for (const change of day.changes) {
    const owner = ownerOf(change.cause);
    if (!owner || change.before === change.entity.state) continue;
    // An automation or a script saying it ran is not a change of the home.
    const id = change.entity.entity_id;
    if (id === owner) continue;
    found.push({ at: change.at, entity: id, state: change.entity.state, owner });
  }
  return found;
}

/** Each entity one automation set and another set otherwise soon after. */
export function conflictsOf(day: DayPlayed): Conflict[] {
  const last = new Map<string, { owner: string; state: string; at: number }>();
  const found: Conflict[] = [];
  for (const change of stateChanges(day)) {
    const before = last.get(change.entity);
    if (
      before &&
      before.owner !== change.owner &&
      before.state !== change.state &&
      change.at - before.at <= CONFLICT_MS
    ) {
      found.push({
        entity: change.entity,
        at: change.at,
        first: before,
        second: { owner: change.owner, state: change.state, at: change.at },
      });
    }
    last.set(change.entity, { owner: change.owner, state: change.state, at: change.at });
  }
  return found;
}

/** Each entity set back and forth by automations, once. */
export function flappingOf(day: DayPlayed): Flapping[] {
  const byEntity = new Map<string, { at: number; owner: string }[]>();
  const found: Flapping[] = [];
  const said = new Set<string>();
  for (const change of stateChanges(day)) {
    const list = byEntity.get(change.entity) ?? [];
    list.push({ at: change.at, owner: change.owner });
    while (list.length > 0 && change.at - (list[0]?.at ?? 0) > FLAP_MS) list.shift();
    byEntity.set(change.entity, list);
    if (list.length >= FLAP_CHANGES && !said.has(change.entity)) {
      said.add(change.entity);
      found.push({
        entity: change.entity,
        at: list[0]?.at ?? change.at,
        changes: list.length,
        owners: [...new Set(list.map((c) => c.owner))],
      });
    }
  }
  return found;
}
