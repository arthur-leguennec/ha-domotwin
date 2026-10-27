/**
 * Automations and scripts as Home Assistant's editors write them, read the same way whatever
 * their age (D-057): `trigger`/`triggers`, `platform`/`trigger`, `condition`/`conditions`,
 * `action`/`actions`, `service`/`action`, one item or a list, and a condition written as a
 * template alone.
 */

export type Config = Record<string, unknown>;

/** A value as a list: a list as it is, one value as a list of it, nothing as none. */
export function listOf(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Texts of a value that may be one text or a list of them. */
export function textsOf(value: unknown): string[] {
  return listOf(value).filter((v): v is string => typeof v === "string");
}

/** Entity ids as Home Assistant reads them: one, a list, or a text with commas. */
export function idsOf(value: unknown): string[] {
  return textsOf(value)
    .flatMap((id) => id.split(","))
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

export function isRecord(value: unknown): value is Config {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An item that is switched off in the editor (`enabled: false`). */
export function disabled(item: Config): boolean {
  return item.enabled === false;
}

/** An automation's triggers. */
export function triggersOf(config: Config): Config[] {
  return listOf(config.triggers ?? config.trigger)
    .filter(isRecord)
    .flatMap((item) =>
      // A list of triggers given as `triggers:` inside one (Home Assistant 2024.10's shorthand).
      Array.isArray(item.triggers) ? item.triggers.filter(isRecord) : [item],
    );
}

/** A trigger's kind (`state`, `time`…): `trigger` since 2024.10, `platform` before. */
export function triggerKind(trigger: Config): string {
  const kind = trigger.trigger ?? trigger.platform;
  return typeof kind === "string" ? kind : "";
}

/** A list of conditions (an automation's, a choice's…): a template alone becomes one. */
export function conditionsOf(value: unknown): Config[] {
  return listOf(value).flatMap((item): Config[] => {
    if (typeof item === "string") return [{ condition: "template", value_template: item }];
    return isRecord(item) ? [item] : [];
  });
}

/** An automation's own conditions. */
export function automationConditions(config: Config): Config[] {
  return conditionsOf(config.conditions ?? config.condition);
}

/** A condition's kind, its shorthands (`and:`, `or:`, `not:`) included. */
export function conditionKind(condition: Config): { kind: string; inner?: Config[] } {
  if (typeof condition.condition === "string") {
    const kind = condition.condition;
    return ["and", "or", "not"].includes(kind)
      ? { kind, inner: conditionsOf(condition.conditions) }
      : { kind };
  }
  for (const kind of ["and", "or", "not"]) {
    if (kind in condition) return { kind, inner: conditionsOf(condition[kind]) };
  }
  return { kind: "" };
}

/** An automation's actions, or a script's sequence. */
export function actionsOf(config: Config): Config[] {
  return stepsOf(config.actions ?? config.action ?? config.sequence);
}

/** A list of steps. */
export function stepsOf(value: unknown): Config[] {
  return listOf(value).filter(isRecord);
}

/** The service a step calls (`light.turn_on`), if it calls one. */
export function serviceOf(step: Config): unknown {
  return step.action ?? step.service ?? step.service_template;
}

/** How an automation or a script runs when set off again while running. */
export interface RunMode {
  mode: "single" | "restart" | "queued" | "parallel";
  max: number;
}

export function modeOf(config: Config): RunMode {
  const mode = config.mode;
  const max = typeof config.max === "number" && config.max > 0 ? Math.floor(config.max) : 10;
  return {
    mode: mode === "restart" || mode === "queued" || mode === "parallel" ? mode : "single",
    max,
  };
}
