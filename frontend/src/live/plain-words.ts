/**
 * An automation said back in plain words (D-070): *When* each trigger, *Only if* each condition,
 * *Then* each action, in order and nested, in the user's language. Worked out from the
 * configuration alone, never from what a model said of it: entities, areas and devices by their
 * names, states as Home Assistant says them, times and durations in words. What has no words of
 * its own is said by its kind and its settings in short; what Home Assistant does not have is
 * marked.
 */
import type { HomeAssistant } from "../ha/types";
import { isEntityId } from "../ha/types";
import type { MessageKey, PluralKey, Translator } from "../i18n";
import {
  actionsOf,
  automationConditions,
  conditionKind,
  conditionsOf,
  disabled,
  idsOf,
  isRecord,
  listOf,
  serviceOf,
  stepsOf,
  textsOf,
  triggerKind,
  triggersOf,
  type Config,
} from "../sandbox/config";
import { parseClock, parseDuration } from "../sandbox/time";
import { entityName } from "./bindings";
import { timeStyle } from "./schedules";

/** A line of the words: a trigger, a condition or an action, with what it holds under it. */
export interface WordsLine {
  text: string;
  /** Lines under it: a choice's options, what a repeat or an `if` does. */
  lines?: WordsLine[];
  /** It names something Home Assistant does not have. */
  unknown?: boolean;
  /** Switched off in the editor (`enabled: false`): Home Assistant passes it over. */
  off?: boolean;
}

export interface AutomationWords {
  when: WordsLine[];
  onlyIf: WordsLine[];
  then: WordsLine[];
  /** How it runs when set off again while running, when it is not the usual (single). */
  mode?: string;
}

/** Templates are said as such, cut to this many characters. */
const TEMPLATE_CHARS = 80;
/** A value of a setting said in short, at most this many characters. */
const VALUE_CHARS = 40;
/** At most this many lines deep: a configuration nested further is said in short. */
const MAX_DEPTH = 12;

const WEEKDAY_INDEX: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

/** A value as a text: a text as it is, a number or a yes as written, anything else as JSON. */
export function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // What has no JSON (nothing, a function) is no text.
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function isTemplateText(value: unknown): boolean {
  return typeof value === "string" && /\{\{|\{%/.test(value);
}

/** The words of an automation's configuration. */
export function automationWords(
  t: Translator,
  hass: HomeAssistant,
  config: Config,
): AutomationWords {
  const say = new Say(t, hass);
  const mode = typeof config.mode === "string" ? config.mode : "single";
  return {
    when: triggersOf(config).map((trigger) => say.trigger(trigger)),
    onlyIf: automationConditions(config).map((condition) => say.conditionLine(condition)),
    then: say.steps(actionsOf(config), 0),
    ...(mode !== "single" && ["restart", "queued", "parallel"].includes(mode)
      ? { mode: t.t(`plain.words.mode.${mode as "restart"}`) }
      : {}),
  };
}

/** The words of the parts of an automation, with what they need of Home Assistant. */
class Say {
  private readonly language: string;
  private readonly hour12?: boolean;
  /** How many times something said named what Home Assistant does not have. */
  private missed = 0;

  constructor(
    private readonly t: Translator,
    private readonly hass: HomeAssistant,
  ) {
    const style = timeStyle(hass);
    this.language = t.language;
    if (style.hour12 !== undefined) this.hour12 = style.hour12;
  }

  // ------------------------------------------------------------------------------- names

  /** Words of one item, with whether it named something Home Assistant does not have. */
  private line(say: () => string, item?: Config, lines?: WordsLine[]): WordsLine {
    // The lines under it are said already: only its own words count.
    const before = this.missed;
    const said = say();
    // A line starts with a capital, whatever its first word ("when an event… starts").
    const text = said.charAt(0).toLocaleUpperCase(this.language) + said.slice(1);
    const unknown = this.missed > before;
    return {
      text,
      ...(lines && lines.length > 0 ? { lines } : {}),
      ...(unknown ? { unknown: true } : {}),
      ...(item && disabled(item) ? { off: true } : {}),
    };
  }

  private entity(id: string): string {
    if (isTemplateText(id)) return this.t.t("plain.words.from_template");
    if (!this.hass.states[id]) {
      this.missed += 1;
      return id;
    }
    return entityName(this.hass, id);
  }

  private area(id: string): string {
    const name = this.hass.areas?.[id]?.name;
    if (name) return name;
    this.missed += 1;
    return id;
  }

  private device(id: string): string {
    const device = this.hass.devices?.[id];
    const name = device?.name_by_user ?? device?.name;
    if (name) return name;
    if (!device) this.missed += 1;
    return id;
  }

  private floor(id: string): string {
    const name = this.hass.floors?.[id]?.name;
    if (name) return name;
    if (this.hass.floors) this.missed += 1;
    return id;
  }

  /** Several things said as a list: "A, B and C" (or "A, B or C"). */
  list(items: readonly string[], or = false): string {
    if (items.length <= 1) return items[0] ?? "";
    try {
      return new Intl.ListFormat(this.language, {
        style: "long",
        type: or ? "disjunction" : "conjunction",
      }).format(items);
    } catch {
      return items.join(", ");
    }
  }

  private entities(value: unknown, or = false): string {
    if (isTemplateText(value)) return this.t.t("plain.words.from_template");
    const ids = idsOf(value);
    if (ids.length === 0) return this.t.t("plain.words.something");
    return this.list(
      ids.map((id) => this.entity(id)),
      or,
    );
  }

  /** Whether every entity named is a zone (whose state is how many people are in it). */
  private zones(value: unknown): boolean {
    const ids = idsOf(value);
    return ids.length > 0 && ids.every((id) => id.startsWith("zone."));
  }

  /** What an action acts on: its entities, areas, devices, floors and labels. */
  private targets(step: Config): string {
    const target = isRecord(step.target) ? step.target : {};
    const data = isRecord(step.data) ? step.data : {};
    const from = (key: string): unknown[] => [
      ...listOf(target[key]),
      ...listOf(step[key]),
      ...listOf(data[key]),
    ];
    const said: string[] = [];
    for (const id of from("entity_id")) {
      if (typeof id !== "string") continue;
      if (isTemplateText(id)) said.push(this.t.t("plain.words.from_template"));
      else if (id === "all") said.push(this.t.t("plain.words.everything"));
      else if (id !== "none") said.push(...idsOf(id).map((each) => this.entity(each)));
    }
    for (const id of from("device_id").filter((v): v is string => typeof v === "string")) {
      said.push(isTemplateText(id) ? this.t.t("plain.words.from_template") : this.device(id));
    }
    for (const id of from("area_id").filter((v): v is string => typeof v === "string")) {
      said.push(
        isTemplateText(id)
          ? this.t.t("plain.words.from_template")
          : this.t.t("plain.words.in_area", { area: this.area(id) }),
      );
    }
    for (const id of from("floor_id").filter((v): v is string => typeof v === "string")) {
      said.push(this.t.t("plain.words.on_floor", { floor: this.floor(id) }));
    }
    for (const id of from("label_id").filter((v): v is string => typeof v === "string")) {
      said.push(this.t.t("plain.words.with_label", { label: id }));
    }
    return this.list(said);
  }

  // ------------------------------------------------------------------------------ values

  /** A state as Home Assistant says it for `entity` ("away" for `not_home`), else as written. */
  private state(entity: string | undefined, value: unknown): string {
    if (value === null) return this.t.t("plain.words.any_state");
    if (isTemplateText(value)) return this.t.t("plain.words.from_template");
    const text = plainText(value);
    const state = entity ? this.hass.states[entity] : undefined;
    if (!state || !this.hass.formatEntityState) return text;
    try {
      const said = this.hass.formatEntityState(state, text);
      // Home Assistant's words start with a capital, which reads oddly inside a sentence; an
      // option of a select, a name, said as it is written, keeps its own.
      return said !== text && said.length > 0
        ? said.charAt(0).toLocaleLowerCase(this.language) + said.slice(1)
        : said;
    } catch {
      return text;
    }
  }

  private states(entity: string | undefined, value: unknown): string {
    const values = Array.isArray(value) ? value : [value];
    return this.list(
      values.map((each) => this.state(entity, each)),
      true,
    );
  }

  /** A number to compare with: a number with the entity's unit, or the entity it is read from. */
  private number(value: unknown, entity: string | undefined): string {
    if (typeof value === "string" && isEntityId(value)) return this.entity(value);
    if (isTemplateText(value)) return this.t.t("plain.words.from_template");
    const unit = entity ? this.hass.states[entity]?.attributes.unit_of_measurement : undefined;
    const number = typeof value === "number" ? value : Number(value);
    const text = Number.isFinite(number)
      ? new Intl.NumberFormat(this.language, { maximumFractionDigits: 2 }).format(number)
      : String(value);
    return typeof unit === "string" && unit ? `${text} ${unit}` : text;
  }

  /** A duration in words ("1 hour and 30 minutes"), from any of Home Assistant's forms. */
  duration(value: unknown): string {
    if (isTemplateText(value) || (isRecord(value) && Object.values(value).some(isTemplateText))) {
      return this.t.t("plain.words.time_from_template");
    }
    const ms = parseDuration(value);
    if (ms === undefined) return this.short(value);
    let seconds = Math.round(Math.abs(ms) / 1000);
    const parts: string[] = [];
    const units: [PluralKey, number][] = [
      ["plain.words.days", 86_400],
      ["plain.words.hours", 3600],
      ["plain.words.minutes", 60],
      ["plain.words.seconds", 1],
    ];
    for (const [key, size] of units) {
      const count = Math.floor(seconds / size);
      seconds -= count * size;
      if (count > 0) parts.push(this.t.tp(key, count));
    }
    return parts.length > 0 ? this.list(parts) : this.t.tp("plain.words.seconds", 0);
  }

  /** A clock time ("07:00", or "7:00 AM" where the user's Home Assistant says so). */
  private clock(text: string): string {
    const seconds = parseClock(text);
    if (seconds === undefined) return text;
    const at = new Date(
      Date.UTC(2000, 0, 1, Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60),
    );
    try {
      const hour12 = this.hour12 !== undefined ? { hour12: this.hour12 } : {};
      // As Home Assistant writes a time: "7:15 AM" on a 12-hour clock, "07:15" on a 24-hour one.
      const twelve =
        new Intl.DateTimeFormat(this.language, { hour: "numeric", ...hour12 }).resolvedOptions()
          .hour12 === true;
      return new Intl.DateTimeFormat(this.language, {
        timeZone: "UTC",
        hour: twelve ? "numeric" : "2-digit",
        minute: "2-digit",
        ...(seconds % 60 !== 0 ? { second: "2-digit" } : {}),
        ...hour12,
      }).format(at);
    } catch {
      return text;
    }
  }

  /** A time of a time trigger or condition: a clock, or the entity that holds it. */
  private time(value: unknown): string {
    if (isRecord(value) && typeof value.entity_id === "string") {
      const offset = parseDuration(value.offset);
      const of = this.t.t("plain.words.time_of", { name: this.entity(value.entity_id) });
      if (!offset) return of;
      return this.t.t(offset < 0 ? "plain.words.before" : "plain.words.after", {
        duration: this.duration(value.offset),
        what: of,
      });
    }
    if (typeof value !== "string") return this.short(value);
    if (isEntityId(value)) return this.t.t("plain.words.time_of", { name: this.entity(value) });
    return this.clock(value);
  }

  private weekdays(value: unknown): string | undefined {
    const days = textsOf(value)
      .map((day) => WEEKDAY_INDEX[day.toLowerCase()])
      .filter((day): day is number => day !== undefined);
    if (days.length === 0) return undefined;
    const names = days.map((day) => {
      // 2024-01-01 was a Monday.
      const at = new Date(Date.UTC(2024, 0, 1 + day));
      try {
        return new Intl.DateTimeFormat(this.language, { weekday: "long", timeZone: "UTC" }).format(
          at,
        );
      } catch {
        return Object.keys(WEEKDAY_INDEX)[day] ?? "";
      }
    });
    return this.list(names, true);
  }

  /** The sun's event with its offset: "sunset", "30 minutes before sunrise". */
  private sun(event: unknown, offset: unknown): string {
    const which = event === "sunrise" ? "sunrise" : "sunset";
    const what = this.t.t(`plain.words.${which}`);
    const ms = parseDuration(offset);
    if (!ms) return what;
    return this.t.t(ms < 0 ? "plain.words.before" : "plain.words.after", {
      duration: this.duration(offset),
      what,
    });
  }

  private template(value: unknown): string {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text.length > TEMPLATE_CHARS ? `${text.slice(0, TEMPLATE_CHARS - 1)}…` : text;
  }

  /** A value in short: a text in quotes, a number, an entity's name, a list, its settings. */
  private short(value: unknown): string {
    if (value === undefined || value === null) return this.t.t("plain.words.nothing");
    if (typeof value === "boolean") return this.t.t(value ? "plain.words.yes" : "plain.words.no");
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
      if (isEntityId(value)) return this.entity(value);
      const text = isTemplateText(value) ? this.template(value) : value;
      return `“${text.length > VALUE_CHARS ? `${text.slice(0, VALUE_CHARS - 1)}…` : text}”`;
    }
    if (Array.isArray(value)) return this.list(value.slice(0, 4).map((item) => this.short(item)));
    if (isRecord(value)) return this.settings(value, []) || this.t.t("plain.words.nothing");
    return this.t.t("plain.words.nothing");
  }

  /** A few settings of an item, `key value`, those said otherwise left out. */
  private settings(item: Config, shown: readonly string[]): string {
    const left = Object.entries(item).filter(
      ([key, value]) =>
        !shown.includes(key) && value !== undefined && key !== "enabled" && key !== "alias",
    );
    const said = left.slice(0, 3).map(([key, value]) => `${key} ${this.shortPlain(value)}`);
    return left.length > 3 ? `${said.join(", ")}, …` : said.join(", ");
  }

  /** A value in short, objects counted rather than opened (an item's settings, once). */
  private shortPlain(value: unknown): string {
    if (Array.isArray(value)) {
      return value.every((v) => !isRecord(v) && !Array.isArray(v))
        ? this.short(value)
        : this.t.tp("plain.words.items", value.length);
    }
    if (isRecord(value)) return this.t.tp("plain.words.settings", Object.keys(value).length);
    return this.short(value);
  }

  /** An alias given in the editor, said before what an item does. */
  private named(item: Config, text: string): string {
    return typeof item.alias === "string" && item.alias.trim()
      ? this.t.t("plain.words.named", { alias: item.alias.trim(), text })
      : text;
  }

  // ---------------------------------------------------------------------------- triggers

  trigger(trigger: Config): WordsLine {
    return this.line(() => this.named(trigger, this.triggerText(trigger)), trigger);
  }

  private triggerText(trigger: Config): string {
    const t = this.t;
    const kind = triggerKind(trigger);
    const first = idsOf(trigger.entity_id)[0];
    const lasting = (text: string): string =>
      trigger.for !== undefined
        ? t.t("plain.words.lasting", { text, duration: this.duration(trigger.for) })
        : text;
    switch (kind) {
      case "state": {
        const entities = this.entities(trigger.entity_id, true);
        const attribute = typeof trigger.attribute === "string" ? trigger.attribute : undefined;
        // A zone's state is how many people are in it: "0", nobody left.
        if (!attribute && this.zones(trigger.entity_id) && String(trigger.to) === "0") {
          return lasting(t.t("plain.words.trigger.zone_empty", { zone: entities }));
        }
        const who = attribute ? t.t("plain.words.attribute_of", { attribute, entities }) : entities;
        const has = (key: string): boolean => key in trigger;
        const said = (value: unknown): string =>
          attribute ? this.short(value) : this.states(first, value);
        let text: string;
        if (has("from") && has("to")) {
          text = t.t("plain.words.trigger.state_from_to", {
            entities: who,
            from: said(trigger.from),
            to: said(trigger.to),
          });
        } else if (has("to") && trigger.to !== null) {
          text = t.t("plain.words.trigger.state_to", { entities: who, to: said(trigger.to) });
        } else if (has("from") && trigger.from !== null) {
          text = t.t("plain.words.trigger.state_from", {
            entities: who,
            from: said(trigger.from),
          });
        } else text = t.t("plain.words.trigger.state", { entities: who });
        const not = [
          ...(trigger.not_to !== undefined
            ? [t.t("plain.words.not_to", { states: this.states(first, trigger.not_to) })]
            : []),
          ...(trigger.not_from !== undefined
            ? [t.t("plain.words.not_from", { states: this.states(first, trigger.not_from) })]
            : []),
        ];
        return lasting(not.length > 0 ? `${text} (${not.join(", ")})` : text);
      }
      case "numeric_state": {
        const entities = this.entities(trigger.entity_id, true);
        const attribute = typeof trigger.attribute === "string" ? trigger.attribute : undefined;
        const who = attribute ? t.t("plain.words.attribute_of", { attribute, entities }) : entities;
        const above = trigger.above !== undefined ? this.number(trigger.above, first) : undefined;
        const below = trigger.below !== undefined ? this.number(trigger.below, first) : undefined;
        const text =
          above !== undefined && below !== undefined
            ? t.t("plain.words.trigger.between", { entities: who, above, below })
            : above !== undefined
              ? t.t("plain.words.trigger.above", { entities: who, above })
              : t.t("plain.words.trigger.below", { entities: who, below: below ?? "" });
        const read = trigger.value_template !== undefined ? ` ${t.t("plain.words.as_read")}` : "";
        return lasting(`${text}${read}`);
      }
      case "time": {
        const times = listOf(trigger.at).map((at) => this.time(at));
        const text = t.t("plain.words.trigger.time", { times: this.list(times) });
        const days = this.weekdays(trigger.weekday);
        return days ? t.t("plain.words.on_days", { text, days }) : text;
      }
      case "time_pattern":
        return this.pattern(trigger);
      case "sun":
        return parseDuration(trigger.offset)
          ? this.sun(trigger.event, trigger.offset)
          : t.t(
              trigger.event === "sunrise"
                ? "plain.words.trigger.sunrise"
                : "plain.words.trigger.sunset",
            );
      case "zone": {
        const zone =
          typeof trigger.zone === "string" ? this.entity(trigger.zone) : this.short(trigger.zone);
        const entities = this.entities(trigger.entity_id, true);
        return trigger.event === "leave"
          ? t.t("plain.words.trigger.zone_leave", { entities, zone })
          : t.t("plain.words.trigger.zone_enter", { entities, zone });
      }
      case "homeassistant":
        return t.t(
          trigger.event === "shutdown"
            ? "plain.words.trigger.ha_stop"
            : "plain.words.trigger.ha_start",
        );
      case "template":
        return lasting(
          t.t("plain.words.trigger.template", { template: this.template(trigger.value_template) }),
        );
      case "event":
        return t.t("plain.words.trigger.event", {
          event: this.list(textsOf(trigger.event_type), true) || this.short(trigger.event_type),
        });
      case "calendar": {
        const calendar = this.entities(trigger.entity_id);
        const end = trigger.event === "end";
        const ms = parseDuration(trigger.offset);
        if (!ms) {
          return t.t(
            end ? "plain.words.trigger.calendar_end" : "plain.words.trigger.calendar_start",
            { calendar },
          );
        }
        const key = `plain.words.trigger.calendar_${ms < 0 ? "before" : "after"}_${end ? "end" : "start"}`;
        return t.t(key as "plain.words.trigger.calendar_before_start", {
          calendar,
          duration: this.duration(trigger.offset),
        });
      }
      case "conversation":
        return t.t("plain.words.trigger.conversation", {
          sentences: this.list(
            textsOf(trigger.command).map((sentence) => `“${sentence}”`),
            true,
          ),
        });
      case "mqtt":
        return t.t("plain.words.trigger.mqtt", { topic: this.short(trigger.topic) });
      case "webhook":
        return t.t("plain.words.trigger.webhook");
      case "tag":
        return t.t("plain.words.trigger.tag");
      case "device":
        return this.deviceWords(trigger, "trigger");
      default: {
        const settings = this.settings(trigger, ["trigger", "platform", "id"]);
        return t.t("plain.words.trigger.other", {
          kind: kind || "?",
          settings: settings || t.t("plain.words.nothing"),
        });
      }
    }
  }

  /** A time pattern: "every 5 minutes", "every hour at minute 15", or as written. */
  private pattern(trigger: Config): string {
    const t = this.t;
    const part = (key: string): string | undefined =>
      trigger[key] === undefined || trigger[key] === null
        ? undefined
        : plainText(trigger[key]).trim();
    const hours = part("hours");
    const minutes = part("minutes");
    const seconds = part("seconds");
    const every = (value: string | undefined): number | undefined => {
      const found = value ? /^\/(\d+)$/.exec(value) : null;
      return found ? Number(found[1]) : undefined;
    };
    const any = (value: string | undefined): boolean => value === undefined || value === "*";
    if (every(minutes) && any(hours) && (seconds === undefined || seconds === "0")) {
      return t.tp("plain.words.trigger.every_minutes", every(minutes) ?? 0);
    }
    if (every(hours) && (minutes === undefined || minutes === "0") && !seconds) {
      return t.tp("plain.words.trigger.every_hours", every(hours) ?? 0);
    }
    if (every(seconds) && any(hours) && any(minutes)) {
      return t.tp("plain.words.trigger.every_seconds", every(seconds) ?? 0);
    }
    if (any(hours) && minutes !== undefined && /^\d+$/.test(minutes) && !seconds) {
      return t.t("plain.words.trigger.every_hour_at", { minute: minutes });
    }
    return t.t("plain.words.trigger.pattern", {
      hours: hours ?? "*",
      minutes: minutes ?? "*",
      seconds: seconds ?? "*",
    });
  }

  /** A device's own trigger, condition or action: its device and what it says it is. */
  private deviceWords(item: Config, role: "trigger" | "condition" | "action"): string {
    const t = this.t;
    const what =
      typeof item.device_id === "string"
        ? this.device(item.device_id)
        : this.t.t("plain.words.a_device");
    const type = typeof item.type === "string" ? item.type : "";
    const known = [
      "turned_on",
      "turned_off",
      "changed_states",
      "is_on",
      "is_off",
      "turn_on",
      "turn_off",
      "toggle",
    ];
    if (known.includes(type)) {
      return t.t(`plain.words.device.${type as "turned_on"}`, { device: what });
    }
    const label = type.replace(/_/g, " ") || this.short(item.domain);
    return t.t(`plain.words.device.${role}`, { device: what, type: label });
  }

  // -------------------------------------------------------------------------- conditions

  conditionLine(condition: Config): WordsLine {
    const { kind, inner } = conditionKind(condition);
    if ((kind === "and" || kind === "or" || kind === "not") && inner) {
      return this.line(
        () =>
          this.named(
            condition,
            this.t.t(
              kind === "and"
                ? "plain.words.condition.all"
                : kind === "or"
                  ? "plain.words.condition.any"
                  : "plain.words.condition.none",
            ),
          ),
        condition,
        inner.map((each) => this.conditionLine(each)),
      );
    }
    return this.line(() => this.named(condition, this.condition(condition)), condition);
  }

  /** A condition in a sentence: nested ones with "and", "or", "not". */
  condition(condition: Config, depth = 0): string {
    const t = this.t;
    const { kind, inner } = conditionKind(condition);
    const first = idsOf(condition.entity_id)[0];
    switch (kind) {
      case "and":
      case "or": {
        const parts = (inner ?? []).map((each) => this.condition(each, depth + 1));
        const said = this.list(parts, kind === "or");
        return depth > 0 && parts.length > 1 ? `(${said})` : said;
      }
      case "not":
        return t.t("plain.words.condition.not", {
          conditions: this.list(
            (inner ?? []).map((each) => this.condition(each, depth + 1)),
            true,
          ),
        });
      case "state": {
        const ids = idsOf(condition.entity_id);
        const entities = this.entities(condition.entity_id, condition.match === "any");
        const attribute = typeof condition.attribute === "string" ? condition.attribute : undefined;
        if (!attribute && this.zones(condition.entity_id) && String(condition.state) === "0") {
          const text = t.t("plain.words.condition.zone_empty", { zone: entities });
          return condition.for !== undefined
            ? t.t("plain.words.for_at_least", { text, duration: this.duration(condition.for) })
            : text;
        }
        const who = attribute ? t.t("plain.words.attribute_of", { attribute, entities }) : entities;
        const states = attribute
          ? this.short(condition.state)
          : this.states(first, condition.state);
        const key: MessageKey =
          ids.length > 1
            ? condition.match === "any"
              ? "plain.words.condition.state_any"
              : "plain.words.condition.state_all"
            : "plain.words.condition.state";
        const text = t.t(key, { entities: who, states });
        return condition.for !== undefined
          ? t.t("plain.words.for_at_least", { text, duration: this.duration(condition.for) })
          : text;
      }
      case "numeric_state": {
        const entities = this.entities(condition.entity_id);
        const attribute = typeof condition.attribute === "string" ? condition.attribute : undefined;
        const who = attribute ? t.t("plain.words.attribute_of", { attribute, entities }) : entities;
        const above =
          condition.above !== undefined ? this.number(condition.above, first) : undefined;
        const below =
          condition.below !== undefined ? this.number(condition.below, first) : undefined;
        return above !== undefined && below !== undefined
          ? t.t("plain.words.condition.between", { entities: who, above, below })
          : above !== undefined
            ? t.t("plain.words.condition.above", { entities: who, above })
            : t.t("plain.words.condition.below", { entities: who, below: below ?? "" });
      }
      case "time": {
        const after = condition.after !== undefined ? this.time(condition.after) : undefined;
        const before = condition.before !== undefined ? this.time(condition.before) : undefined;
        const days = this.weekdays(condition.weekday);
        const parts = [
          after !== undefined && before !== undefined
            ? t.t("plain.words.condition.time_between", { after, before })
            : after !== undefined
              ? t.t("plain.words.condition.time_after", { after })
              : before !== undefined
                ? t.t("plain.words.condition.time_before", { before })
                : undefined,
          days ? t.t("plain.words.condition.days", { days }) : undefined,
        ].filter((part): part is string => part !== undefined);
        return parts.length > 0 ? this.list(parts) : t.t("plain.words.condition.any_time");
      }
      case "sun": {
        const after =
          condition.after !== undefined
            ? this.sun(condition.after, condition.after_offset)
            : undefined;
        const before =
          condition.before !== undefined
            ? this.sun(condition.before, condition.before_offset)
            : undefined;
        if (after !== undefined && before !== undefined) {
          return t.t("plain.words.condition.time_between", { after, before });
        }
        if (after !== undefined) return t.t("plain.words.condition.time_after", { after });
        return t.t("plain.words.condition.time_before", { before: before ?? "" });
      }
      case "template":
        return t.t("plain.words.condition.template", {
          template: this.template(condition.value_template),
        });
      case "zone":
        return t.t("plain.words.condition.zone", {
          entities: this.entities(condition.entity_id),
          zone: this.entities(condition.zone, true),
        });
      case "trigger":
        return t.t("plain.words.condition.trigger", {
          ids: this.list(
            listOf(condition.id).map((id) => `“${String(id)}”`),
            true,
          ),
        });
      case "device":
        return this.deviceWords(condition, "condition");
      default:
        return t.t("plain.words.condition.other", {
          kind: kind || "?",
          settings: this.settings(condition, ["condition"]) || t.t("plain.words.nothing"),
        });
    }
  }

  /** Conditions in one sentence: "A and B". */
  private conditions(value: unknown): string {
    return this.list(conditionsOf(value).map((each) => this.condition(each, 1)));
  }

  // ----------------------------------------------------------------------------- actions

  steps(steps: readonly Config[], depth: number): WordsLine[] {
    return steps.map((step) => this.step(step, depth));
  }

  private step(step: Config, depth: number): WordsLine {
    const t = this.t;
    if (depth > MAX_DEPTH) return this.line(() => this.settings(step, []), step);
    const nested = (value: unknown): WordsLine[] => this.steps(stepsOf(value), depth + 1);
    const action = serviceOf(step);
    if (typeof action === "string")
      return this.line(() => this.named(step, this.call(action, step)), step);
    if ("delay" in step) {
      return this.line(
        () =>
          this.named(
            step,
            t.t("plain.words.action.delay", { duration: this.duration(step.delay) }),
          ),
        step,
      );
    }
    if ("wait_template" in step) {
      return this.line(
        () =>
          this.named(
            step,
            this.timeout(
              step,
              t.t("plain.words.action.wait_template", {
                template: this.template(step.wait_template),
              }),
            ),
          ),
        step,
      );
    }
    if ("wait_for_trigger" in step) {
      const triggers = listOf(step.wait_for_trigger)
        .filter(isRecord)
        .map((trigger) => this.trigger(trigger));
      return this.line(
        () => this.named(step, this.timeout(step, t.t("plain.words.action.wait_trigger"))),
        step,
        triggers,
      );
    }
    if ("choose" in step) {
      const options = listOf(step.choose)
        .filter(isRecord)
        .map((option) =>
          this.line(
            () =>
              t.t("plain.words.action.option", { conditions: this.conditions(option.conditions) }),
            option,
            nested(option.sequence),
          ),
        );
      if (step.default !== undefined) {
        options.push(
          this.line(() => t.t("plain.words.action.otherwise"), undefined, nested(step.default)),
        );
      }
      return this.line(() => this.named(step, t.t("plain.words.action.choose")), step, options);
    }
    if ("if" in step) {
      const branches = [
        this.line(() => t.t("plain.words.action.then"), undefined, nested(step.then)),
        ...(step.else !== undefined
          ? [this.line(() => t.t("plain.words.action.otherwise"), undefined, nested(step.else))]
          : []),
      ];
      return this.line(
        () =>
          this.named(step, t.t("plain.words.action.if", { conditions: this.conditions(step.if) })),
        step,
        branches,
      );
    }
    if (isRecord(step.repeat)) {
      const repeat = step.repeat;
      const text = (): string =>
        repeat.count !== undefined
          ? t.t("plain.words.action.repeat_count", { count: this.short(repeat.count) })
          : repeat.while !== undefined
            ? t.t("plain.words.action.repeat_while", { conditions: this.conditions(repeat.while) })
            : repeat.until !== undefined
              ? t.t("plain.words.action.repeat_until", {
                  conditions: this.conditions(repeat.until),
                })
              : t.t("plain.words.action.repeat_each", { items: this.short(repeat.for_each) });
      return this.line(() => this.named(step, text()), step, nested(repeat.sequence));
    }
    if ("parallel" in step) {
      const branches = listOf(step.parallel)
        .filter(isRecord)
        .map((branch) =>
          "sequence" in branch && serviceOf(branch) === undefined
            ? this.line(() => t.t("plain.words.action.sequence"), branch, nested(branch.sequence))
            : this.step(branch, depth + 1),
        );
      return this.line(() => this.named(step, t.t("plain.words.action.parallel")), step, branches);
    }
    if ("sequence" in step) {
      return this.line(
        () => this.named(step, t.t("plain.words.action.sequence")),
        step,
        nested(step.sequence),
      );
    }
    if ("stop" in step) {
      return this.line(
        () =>
          this.named(
            step,
            t.t(step.error === true ? "plain.words.action.stop_error" : "plain.words.action.stop", {
              reason: this.short(step.stop),
            }),
          ),
        step,
      );
    }
    if ("condition" in step || "and" in step || "or" in step || "not" in step) {
      return this.line(
        () =>
          this.named(
            step,
            t.t("plain.words.action.condition", { condition: this.condition(step) }),
          ),
        step,
      );
    }
    if (isRecord(step.variables)) {
      const names = Object.keys(step.variables);
      return this.line(
        () => this.named(step, t.t("plain.words.action.variables", { names: this.list(names) })),
        step,
      );
    }
    if ("event" in step) {
      return this.line(
        () => this.named(step, t.t("plain.words.action.event", { event: this.short(step.event) })),
        step,
      );
    }
    if ("scene" in step) {
      return this.line(
        () =>
          this.named(step, t.t("plain.words.action.scene", { targets: this.entities(step.scene) })),
        step,
      );
    }
    if (step.device_id !== undefined && typeof step.domain === "string") {
      return this.line(() => this.named(step, this.deviceWords(step, "action")), step);
    }
    return this.line(
      () =>
        this.named(
          step,
          t.t("plain.words.action.other", {
            settings: this.settings(step, []) || t.t("plain.words.nothing"),
          }),
        ),
      step,
    );
  }

  private timeout(step: Config, text: string): string {
    return step.timeout !== undefined
      ? this.t.t("plain.words.at_most", { text, duration: this.duration(step.timeout) })
      : text;
  }

  /** An action called, in words where it has some, else by its name. */
  private call(action: string, step: Config): string {
    const t = this.t;
    if (isTemplateText(action)) {
      return t.t("plain.words.action.call_template", { template: this.template(action) });
    }
    const [domain = "", service = ""] = action.split(".", 2);
    const known = this.hass.services;
    if (known && !known[domain]?.[service]) this.missed += 1;
    const data = isRecord(step.data) ? step.data : {};
    const targets = this.targets(step);
    const say = (key: MessageKey, params: Record<string, string> = {}): string =>
      t.t(key, { targets: targets || t.t("plain.words.something"), ...params });
    const value = (key: string): string => this.short(data[key]);
    const plainKey = (name: string): MessageKey => `plain.words.do.${name}` as MessageKey;
    switch (domain) {
      case "notify": {
        const message = this.short(data.message);
        if (service === "send_message") return say("plain.words.do.notify_entity", { message });
        return t.t("plain.words.do.notify", {
          to:
            service === "notify"
              ? t.t("plain.words.everyone_notified")
              : service.replace(/_/g, " "),
          message,
        });
      }
      case "persistent_notification":
        if (service === "create")
          return t.t("plain.words.do.persistent", { message: this.short(data.message) });
        break;
      case "tts":
        return say("plain.words.do.tts", { message: this.short(data.message) });
      case "script":
        if (!["turn_on", "turn_off", "toggle", "reload"].includes(service)) {
          return t.t("plain.words.do.run", { targets: this.entity(action) });
        }
        if (service === "turn_on") return say("plain.words.do.run");
        break;
      case "scene":
        if (service === "turn_on") return say("plain.words.do.scene");
        break;
      case "automation":
        if (service === "trigger") return say("plain.words.do.set_off");
        if (service === "turn_on") return say("plain.words.do.enable");
        if (service === "turn_off") return say("plain.words.do.disable");
        break;
      case "climate":
        if (service === "set_temperature") {
          const unit = this.hass.config?.unit_system?.temperature ?? "°C";
          const degrees = (key: string): string =>
            typeof data[key] === "number"
              ? `${this.number(data[key], undefined)} ${unit}`
              : value(key);
          return data.temperature !== undefined
            ? say("plain.words.do.set_to", { value: degrees("temperature") })
            : say("plain.words.do.set_between", {
                low: degrees("target_temp_low"),
                high: degrees("target_temp_high"),
              });
        }
        if (service === "set_hvac_mode") {
          const first = this.firstTarget(step);
          return say("plain.words.do.set_to", { value: this.state(first, data.hvac_mode) });
        }
        if (service === "set_preset_mode")
          return say("plain.words.do.preset", { value: value("preset_mode") });
        break;
      case "cover":
        if (service === "set_cover_position")
          return say("plain.words.do.position", { value: value("position") });
        break;
      case "media_player":
        if (service === "volume_set") {
          const level =
            typeof data.volume_level === "number" ? Math.round(data.volume_level * 100) : undefined;
          return say("plain.words.do.volume", {
            value: level !== undefined ? String(level) : value("volume_level"),
          });
        }
        if (service === "play_media") {
          return say("plain.words.do.play_media", {
            value: this.short(data.media_content_id ?? data.media),
          });
        }
        break;
      case "input_select":
      case "select":
        if (service === "select_option")
          return say("plain.words.do.option", { value: value("option") });
        break;
      case "input_number":
      case "number":
      case "input_text":
      case "text":
      case "input_datetime":
        if (service === "set_value" || service === "set_datetime") {
          return say("plain.words.do.set_to", {
            value: value(
              service === "set_value"
                ? "value"
                : (["datetime", "date", "time"].find((k) => k in data) ?? "value"),
            ),
          });
        }
        break;
      case "fan":
        if (service === "set_percentage")
          return say("plain.words.do.percentage", { value: value("percentage") });
        break;
      case "vacuum":
        if (service === "return_to_base") return say("plain.words.do.dock");
        break;
      case "timer":
        if (service === "start" && data.duration !== undefined) {
          return say("plain.words.do.timer", { duration: this.duration(data.duration) });
        }
        break;
      default:
        break;
    }
    const verbs = [
      "turn_on",
      "turn_off",
      "toggle",
      "open_cover",
      "close_cover",
      "stop_cover",
      "lock",
      "unlock",
      "open",
      "press",
      "start",
      "stop",
      "pause",
      "media_play",
      "media_pause",
      "media_stop",
      "media_next_track",
      "increment",
      "decrement",
      "reset",
      "cancel",
      "finish",
    ];
    if (verbs.includes(service)) {
      const base = say(plainKey(service));
      if (domain === "light" && service === "turn_on") return this.lightDetails(base, data);
      return base;
    }
    const settings = this.settings(data, ["entity_id", "area_id", "device_id"]);
    const text = targets
      ? t.t("plain.words.do.other_on", { action, targets })
      : t.t("plain.words.do.other", { action });
    return settings ? `${text} (${settings})` : text;
  }

  /** What a lamp is switched on with: its brightness, colour, warmth, how slowly. */
  private lightDetails(base: string, data: Config): string {
    const t = this.t;
    const details: string[] = [];
    if (typeof data.brightness_pct === "number") {
      details.push(
        t.t("plain.words.light.brightness", { value: String(Math.round(data.brightness_pct)) }),
      );
    } else if (typeof data.brightness === "number") {
      details.push(
        t.t("plain.words.light.brightness", {
          value: String(Math.round((data.brightness / 255) * 100)),
        }),
      );
    }
    if (typeof data.color_name === "string")
      details.push(t.t("plain.words.light.color", { value: data.color_name }));
    if (typeof data.color_temp_kelvin === "number") {
      details.push(t.t("plain.words.light.kelvin", { value: String(data.color_temp_kelvin) }));
    }
    if (data.transition !== undefined) {
      details.push(
        t.t("plain.words.light.transition", { duration: this.duration(data.transition) }),
      );
    }
    return details.length > 0 ? `${base}, ${this.list(details)}` : base;
  }

  private firstTarget(step: Config): string | undefined {
    const target = isRecord(step.target) ? step.target : {};
    return idsOf(target.entity_id ?? step.entity_id)[0];
  }
}

/** The texts of a line and those under it, as one text (for copying, for screen readers). */
export function wordsText(lines: readonly WordsLine[], indent = ""): string {
  return lines
    .map((line) => {
      const own = `${indent}• ${line.text}`;
      return line.lines ? `${own}\n${wordsText(line.lines, `${indent}  `)}` : own;
    })
    .join("\n");
}
