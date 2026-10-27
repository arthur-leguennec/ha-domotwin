/**
 * An automation in plain words (D-069): what Home Assistant's AI task is given and asked, its
 * answer read, what Home Assistant's check leaves out (the names), Home Assistant's own check,
 * and the save through its configuration API, as its editor saves. DomoTwin calls no model
 * itself: the AI task the user set up in Home Assistant writes the automation.
 */
import type { HomeAssistant } from "../ha/types";
import { domainOf, isEntityId } from "../ha/types";
import {
  actionsOf,
  automationConditions,
  idsOf,
  isRecord,
  listOf,
  serviceOf,
  triggersOf,
  type Config,
} from "../sandbox/config";
import { areaOf, entityName, shownEntity } from "./bindings";
import { isTemplateText } from "./plain-words";
import { seen, type Unseen } from "./privacy";
import { unaccented } from "./text";

/** The task's name, as Home Assistant's logs show it. */
export const TASK_NAME = "DomoTwin: an automation in plain words";
/** At most this many entities are named to the AI task: those in an area first. */
export const MAX_TASK_ENTITIES = 1000;
/** A request, or a change asked, of at most this many characters. */
export const MAX_REQUEST = 2000;
/** At most this many options or modes said of an entity. */
const MAX_OPTIONS = 12;
/** At most this many actions said of a domain. */
const MAX_SERVICES = 60;
/** The domains whose actions are said whatever the entities (to tell someone something). */
const TELLING = ["notify", "persistent_notification"];

/** What the AI task is asked to answer, as `ai_task.generate_data`'s `structure` takes it. */
export const STRUCTURE = {
  name: {
    description: "A short name for the automation, in the language of the request.",
    required: true,
    selector: { text: {} },
  },
  automation: {
    description:
      "The automation as one JSON object, as Home Assistant's automation editor saves it: triggers, conditions, actions and mode. JSON only.",
    required: true,
    selector: { text: { multiline: true } },
  },
  notes: {
    description:
      "What you assumed, or could not do with the entities given, in one or two short sentences in the language of the request. Empty when there is nothing to say.",
    required: false,
    selector: { text: { multiline: true } },
  },
} as const;

/** The home as the AI task is told it. */
export interface TaskHome {
  text: string;
  /** How many entities are named, and how many could have been. */
  entities: number;
  total: number;
}

/** A draft of an automation, as the AI task wrote it and DomoTwin read it. */
export interface PlainDraft {
  name: string;
  /** `triggers`, `conditions`, `actions`, `mode`, and the other keys Home Assistant takes; no
   * id, alias or description (those are DomoTwin's to give). */
  config: Config;
  /** What the AI task said of it, in its own words. */
  notes?: string;
  /** What it wrote that Home Assistant's automations do not take, left out (`initial_state`…). */
  dropped?: string[];
}

/** Why an answer could not be read. */
export type AnswerProblem = "empty" | "not_json" | "not_automation";

/** One line of an entity for the AI task: its id, name, area and what helps write it. */
function entityLine(hass: HomeAssistant, id: string): string {
  const entity = hass.states[id];
  const attributes = entity?.attributes ?? {};
  const details: string[] = [];
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? oneLine(value) : undefined;
  const add = (label: string, value: unknown): void => {
    const list = Array.isArray(value) ? value.map(text).filter(Boolean) : [];
    if (list.length > 0) {
      const shown = list.slice(0, MAX_OPTIONS).join(", ");
      details.push(`${label}: ${list.length > MAX_OPTIONS ? `${shown}, …` : shown}`);
    }
  };
  const kind = text(attributes.device_class);
  const unit = text(attributes.unit_of_measurement);
  if (kind) details.push(kind);
  if (unit) details.push(unit);
  const domain = domainOf(id);
  if (domain === "select" || domain === "input_select") add("options", attributes.options);
  if (domain === "climate") {
    add("modes", attributes.hvac_modes);
    add("presets", attributes.preset_modes);
  }
  if (domain === "fan" || domain === "humidifier") add("presets", attributes.preset_modes);
  if (domain === "humidifier") add("modes", attributes.available_modes);
  if (domain === "number" || domain === "input_number") {
    const { min, max } = attributes;
    if (typeof min === "number" && typeof max === "number") details.push(`${min} to ${max}`);
  }
  const area = areaOf(hass, id);
  const name = oneLine(entityName(hass, id));
  return `${id}: ${name}${area ? ` [${area}]` : ""}${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
}

/** A text on one line, without what would break the list it is in. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * The home, as the AI task is told it: its areas, its entities (id, name, area, what helps write
 * it; never their states) and the actions of their domains. Hidden entities, those of a
 * category and those of a private room the viewer may not see (`unseen`) are left out; at most
 * `MAX_TASK_ENTITIES`, those in an area first.
 */
export function taskHome(hass: HomeAssistant, unseen: Unseen, limit = MAX_TASK_ENTITIES): TaskHome {
  const areas = Object.values(hass.areas ?? {})
    .filter((area): area is NonNullable<typeof area> => area !== undefined)
    .filter((area) => !unseen.areas.has(area.area_id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const areaName = new Map(areas.map((area) => [area.area_id, area.name]));
  const candidates = Object.keys(hass.states)
    .filter((id) => shownEntity(hass, id) && !id.startsWith("ai_task."))
    .filter((id) => seen(unseen, id, areaOf(hass, id)));
  const placed = (id: string): string | undefined => {
    const area = areaOf(hass, id);
    return area && areaName.has(area) ? area : undefined;
  };
  candidates.sort((a, b) => {
    const [areaA, areaB] = [placed(a), placed(b)];
    if (areaA && !areaB) return -1;
    if (areaB && !areaA) return 1;
    if (areaA && areaB && areaA !== areaB) {
      return (areaName.get(areaA) ?? "").localeCompare(areaName.get(areaB) ?? "");
    }
    return a.localeCompare(b);
  });
  const named = candidates.slice(0, Math.max(0, limit));
  const lines = [
    "Areas (area_id: name):",
    ...(areas.length > 0
      ? areas.map((area) => `${area.area_id}: ${oneLine(area.name)}`)
      : ["(none)"]),
    "",
    "Entities (entity_id: name [area_id] (details)):",
    ...named.map((id) => entityLine(hass, id)),
  ];
  const services = hass.services;
  if (services) {
    const domains = [...new Set([...named.map(domainOf), ...TELLING])].sort();
    const said = domains
      .map((domain) => {
        const names = Object.keys(services[domain] ?? {}).sort();
        if (names.length === 0) return undefined;
        const shown = names.slice(0, MAX_SERVICES).join(", ");
        return `${domain}: ${names.length > MAX_SERVICES ? `${shown}, …` : shown}`;
      })
      .filter((line): line is string => line !== undefined);
    lines.push("", "Actions (domain: names):", ...said);
  }
  return { text: lines.join("\n"), entities: named.length, total: candidates.length };
}

/** The rules the AI task is given with the request. */
function rules(home: TaskHome, hass: HomeAssistant): string {
  return [
    "Answer with three fields:",
    "- name: a short name for the automation, in the language of the request.",
    "- automation: the automation as one JSON object, as Home Assistant's automation editor saves it:",
    '  "triggers": a list, each with "trigger" (state, numeric_state, time, time_pattern, sun, zone, template, homeassistant, event...);',
    '  "conditions": a list, each with "condition" (state, numeric_state, time, sun, zone, template, and, or, not...), or an empty list;',
    '  "actions": a list; to act on something: {"action": "<domain>.<name>", "target": {"entity_id": [...]}, "data": {...}};',
    '  "mode": "single", "restart", "queued" or "parallel".',
    '  No "id", "alias" or "description". JSON only: no comments, no code fences.',
    "- notes: what you assumed, or what you could not do with these entities, in one or two short sentences in the language of the request; empty when there is nothing to say.",
    "",
    `Use only the entity ids, area ids${hass.services ? " and actions" : ""} below, never one of your own. Prefer state, numeric_state, time and sun triggers to templates. States are written as Home Assistant stores them ("on", "off", "home", "not_home", "open", "closed", "locked", "unlocked"...).${hass.states["zone.home"] ? ' zone.home\'s state is the number of people at home: "0" when everyone is out.' : ""}`,
    "",
    "The home:",
    home.text,
  ].join("\n");
}

/** What the AI task is asked: the request and the home, or a change of a draft. */
export function instructionsFor(
  hass: HomeAssistant,
  home: TaskHome,
  request: string,
  change?: { draft: PlainDraft; asked: string },
): string {
  const quoted = (text: string): string => `"""\n${text.trim()}\n"""`;
  const head = change
    ? [
        "Change a Home Assistant automation as a person of the home asks.",
        "",
        "What they asked first:",
        quoted(request),
        "",
        "The automation written for it, as JSON:",
        JSON.stringify({ alias: change.draft.name, ...change.draft.config }),
        "",
        "The change they ask now:",
        quoted(change.asked),
        "",
        "Answer with the whole automation, changed.",
      ]
    : [
        "Write one Home Assistant automation that does what a person of the home asks:",
        quoted(request),
      ];
  return [...head, "", rules(home, hass)].join("\n");
}

/** Asks Home Assistant's AI task `entity`; the data it gives, as it gives it. */
export async function askAiTask(
  hass: HomeAssistant,
  entity: string,
  instructions: string,
): Promise<unknown> {
  const answer = await hass.connection.sendMessagePromise<{ response?: { data?: unknown } }>({
    type: "call_service",
    domain: "ai_task",
    service: "generate_data",
    service_data: {
      task_name: TASK_NAME,
      entity_id: entity,
      instructions,
      structure: STRUCTURE,
    },
    return_response: true,
  });
  return answer.response?.data;
}

/** The AI task Home Assistant prefers, if it has one and it is among `tasks`. */
export async function preferredAiTask(
  hass: HomeAssistant,
  tasks: readonly string[],
): Promise<string | undefined> {
  try {
    const preferences = await hass.connection.sendMessagePromise<{ gen_data_entity_id?: unknown }>({
      type: "ai_task/preferences/get",
    });
    const preferred = preferences.gen_data_entity_id;
    return typeof preferred === "string" && tasks.includes(preferred) ? preferred : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON object in a text: as it is, in code fences, or with words around it. */
function jsonIn(text: string): unknown {
  const attempts = [text.trim()];
  const fenced = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) attempts.push(text.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // The next way.
    }
  }
  return undefined;
}

/** The keys DomoTwin writes itself, or reads in their plural form. */
const OWN_KEYS = [
  "id",
  "alias",
  "description",
  "trigger",
  "triggers",
  "condition",
  "conditions",
  "action",
  "actions",
  "sequence",
  "mode",
];
/**
 * The other keys Home Assistant's automations take (`automation/config.py`, the same from 2025.1
 * to 2026.10), and nothing else: it refuses any other. Not `initial_state`, which could save it
 * switched off, nor the deprecated `hide_entity`.
 */
const KEPT_KEYS = ["variables", "trigger_variables", "max", "max_exceeded", "trace"];

/** What the AI task answered, read as a draft, or why it cannot be. */
export function readAnswer(data: unknown): { draft: PlainDraft } | { problem: AnswerProblem } {
  const fields = isRecord(data) ? data : { automation: data };
  let automation: unknown = fields.automation;
  if (automation === undefined && isRecord(data) && ("triggers" in data || "trigger" in data)) {
    automation = data;
  }
  if (automation === undefined || automation === null || automation === "") {
    return { problem: "empty" };
  }
  if (typeof automation === "string") {
    automation = jsonIn(automation);
    if (automation === undefined) return { problem: "not_json" };
  }
  if (Array.isArray(automation) && automation.length === 1) automation = automation[0];
  // An automation wrapped once more: `{"automation": {...}}`.
  if (isRecord(automation) && isRecord(automation.automation) && !("triggers" in automation)) {
    automation = automation.automation;
  }
  if (!isRecord(automation)) return { problem: "not_automation" };
  const config = normalized(automation);
  if (!config) return { problem: "not_automation" };
  const dropped = Object.keys(automation).filter(
    (key) => !OWN_KEYS.includes(key) && !(key in config),
  );
  const named = [fields.name, automation.alias].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  const notes = typeof fields.notes === "string" ? fields.notes.trim() : "";
  return {
    draft: {
      name: oneLine(named ?? "").slice(0, 120),
      config,
      ...(notes ? { notes } : {}),
      ...(dropped.length > 0 ? { dropped } : {}),
    },
  };
}

/**
 * An automation as Home Assistant's editor saves it today: `triggers`, `conditions`, `actions`
 * and `mode`, with the other keys Home Assistant takes; none without a trigger and an action.
 */
export function normalized(automation: Config): Config | undefined {
  const triggers = triggersOf(automation);
  const actions = actionsOf(automation);
  if (triggers.length === 0 || actions.length === 0) return undefined;
  const rest = Object.fromEntries(
    Object.entries(automation).filter(
      // Home Assistant runs at most `max` at once from two up (`queued`, `parallel`).
      ([key, value]) =>
        KEPT_KEYS.includes(key) &&
        (key !== "max" || (typeof value === "number" && Number.isInteger(value) && value >= 2)),
    ),
  );
  const mode = automation.mode;
  return {
    triggers,
    conditions: automationConditions(automation),
    actions,
    mode: mode === "restart" || mode === "queued" || mode === "parallel" ? mode : "single",
    ...rest,
  };
}

/** What an automation names that Home Assistant does not have. */
export interface UnknownNames {
  entities: string[];
  areas: string[];
  devices: string[];
  floors: string[];
  actions: string[];
}

/** The keys whose values name entities, areas, devices and floors. */
const NAME_KEYS = {
  entity_id: "entities",
  area_id: "areas",
  device_id: "devices",
  floor_id: "floors",
} as const;

/**
 * What the automation names that Home Assistant does not have: entities, areas, devices and
 * floors (what its own check leaves out), and the actions it calls, where Home Assistant says
 * them. Templates are left out: only Home Assistant can read them, when it runs them.
 */
export function unknownNames(hass: HomeAssistant, config: Config): UnknownNames {
  const found: UnknownNames = { entities: [], areas: [], devices: [], floors: [], actions: [] };
  const add = (list: string[], value: string): void => {
    if (!list.includes(value)) list.push(value);
  };
  const known = {
    entities: (id: string) => hass.states[id] !== undefined,
    areas: (id: string) => hass.areas === undefined || hass.areas[id] !== undefined,
    devices: (id: string) => hass.devices === undefined || hass.devices[id] !== undefined,
    floors: (id: string) => hass.floors === undefined || hass.floors[id] !== undefined,
  };
  const entityValue = (value: unknown): void => {
    if (typeof value !== "string" || isTemplateText(value)) return;
    if (isEntityId(value) && !known.entities(value)) add(found.entities, value);
  };
  const walk = (node: unknown, depth: number): void => {
    if (depth > 40) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, list] of Object.entries(NAME_KEYS)) {
      if (!(key in node)) continue;
      for (const value of listOf(node[key])) {
        if (typeof value !== "string" || isTemplateText(value)) continue;
        for (const id of list === "entities" ? idsOf(value) : [value]) {
          if (list === "entities" && (id === "all" || id === "none")) continue;
          // A device's own trigger names its entity by its registry id, not its entity id.
          if (list === "entities" && !isEntityId(id) && "device_id" in node) continue;
          if (!known[list](id)) add(found[list], id);
        }
      }
    }
    // Where else entities are named: a zone, a scene, the time of a time trigger.
    if ("zone" in node) for (const zone of listOf(node.zone)) entityValue(zone);
    if (typeof node.scene === "string") entityValue(node.scene);
    if ((node.trigger === "time" || node.platform === "time") && "at" in node) {
      for (const at of listOf(node.at)) entityValue(isRecord(at) ? at.entity_id : at);
    }
    const action = serviceOf(node);
    if (typeof action === "string" && !isTemplateText(action) && hass.services) {
      const [domain = "", service = ""] = action.split(".", 2);
      if (!hass.services[domain]?.[service]) add(found.actions, action);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key in NAME_KEYS) continue;
      walk(value, depth + 1);
    }
  };
  walk(config, 0);
  return found;
}

export function hasUnknown(names: UnknownNames): boolean {
  return [names.entities, names.areas, names.devices, names.floors, names.actions].some(
    (list) => list.length > 0,
  );
}

/** What Home Assistant's own check refused, part by part. */
export interface CheckProblem {
  part: "triggers" | "conditions" | "actions";
  error: string;
}

/** Home Assistant's own check of the triggers, conditions and actions (`validate_config`). */
export async function checkWithHomeAssistant(
  hass: HomeAssistant,
  config: Config,
): Promise<CheckProblem[]> {
  const answer = await hass.connection.sendMessagePromise<
    Partial<Record<CheckProblem["part"], { valid?: unknown; error?: unknown }>>
  >({
    type: "validate_config",
    triggers: config.triggers,
    conditions: config.conditions ?? [],
    actions: config.actions,
  });
  const problems: CheckProblem[] = [];
  for (const part of ["triggers", "conditions", "actions"] as const) {
    const result = answer[part];
    if (result && result.valid === false) {
      problems.push({ part, error: typeof result.error === "string" ? result.error : "" });
    }
  }
  return problems;
}

/** The automation as it is saved: its name, the request as its description, then the rest. */
export function savedConfig(draft: PlainDraft, description: string): Config {
  return {
    alias: draft.name,
    ...(description ? { description } : {}),
    ...draft.config,
  };
}

/**
 * Saves the automation as Home Assistant's editor does: a new id from the time, its
 * configuration API (which checks it, writes the file and reloads it). The id saved.
 */
export async function saveAutomation(
  hass: HomeAssistant,
  config: Config,
  now = Date.now(),
): Promise<string> {
  if (!hass.callApi) throw new Error("callApi");
  const id = String(now);
  await hass.callApi("POST", `config/automation/config/${encodeURIComponent(id)}`, config);
  return id;
}

/** The entity id a new automation of this name would get, as Home Assistant makes one. */
export function draftEntityId(name: string, taken: (id: string) => boolean): string {
  const slug = unaccented(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  const base = `automation.${slug || "draft"}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

/** Home Assistant's editor of a saved automation, and of a new one. */
export function editorOf(id?: string): string {
  return id === undefined
    ? "/config/automation/edit/new"
    : `/config/automation/edit/${encodeURIComponent(id)}`;
}
