/**
 * Home Assistant's own Security page (`docs/DECISIONS.md`, D-064), opened rather than copied
 * where Home Assistant has it (its `security` panel, 2025.12 and later), and the alerts an
 * administrator chose on it (2026.9 and later), read as its frontend reads them
 * (`security-alerts.ts`, 20260930.2) and shown in DomoTwin's banner beside the rooms' alerts.
 */
import { domainOf, type HomeAssistant } from "../ha/types";
import { areaOf, entityName } from "./bindings";
import type { AlertLevel } from "./layers";
import { versionAtLeast } from "./overview";
import { NOTHING_UNSEEN, seen, type Unseen } from "./privacy";
import type { StoreyAlert } from "./storeys";

/** The version from which Home Assistant's Security page is no longer an experiment. */
const SECURITY_SINCE: readonly [number, number] = [2025, 12];
/** The version from which an administrator chooses its alerts. */
const ALERTS_SINCE: readonly [number, number] = [2026, 9];

/**
 * The address of Home Assistant's Security page, where it has one, with its back button (as its
 * Overview opens it): never for the demo house or the sandbox, whose devices are not the home's.
 */
export function securityPage(hass: HomeAssistant | undefined): string | undefined {
  if (!hass || hass.demo === true || hass.sandbox === true) return undefined;
  if (!hass.panels?.security || !versionAtLeast(hass.config?.version, SECURITY_SINCE)) {
    return undefined;
  }
  return "/security?historyBack=1";
}

/** Whether Home Assistant keeps alerts chosen on its Security page, to be read. */
export function securityAlertsKept(hass: HomeAssistant | undefined): boolean {
  return securityPage(hass) !== undefined && versionAtLeast(hass?.config?.version, ALERTS_SINCE);
}

/** An entity an administrator chose as an alert on Home Assistant's Security page. */
export interface SecurityAlertChoice {
  entity: string;
  /** Its severity, when chosen: `alert` (red) or `warning` (amber). */
  severity?: "alert" | "warning";
}

/** The alerts of Home Assistant's system data (`security`), what is not understood left out. */
export function readSecurityAlerts(value: unknown): SecurityAlertChoice[] {
  if (typeof value !== "object" || value === null) return [];
  const raw = (value as { alert_entities?: unknown }).alert_entities;
  if (!Array.isArray(raw)) return [];
  const choices: SecurityAlertChoice[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { entity, severity } = item as { entity?: unknown; severity?: unknown };
    if (typeof entity !== "string" || choices.some((choice) => choice.entity === entity)) continue;
    choices.push(
      severity === "alert" || severity === "warning" ? { entity, severity } : { entity },
    );
  }
  return choices;
}

/** One of Home Assistant's alerts, on now. */
export interface SecurityAlert {
  entity: string;
  name: string;
  /** Its state as Home Assistant says it. */
  state: string;
  level: AlertLevel;
}

/** Binary sensors whose alert is red unless chosen otherwise, as Home Assistant 2026.10 has it. */
const DANGER_CLASSES = new Set([
  "carbon_monoxide",
  "gas",
  "glass_break",
  "moisture",
  "safety",
  "smoke",
]);

/** The states in which Home Assistant shows an entity's alert: an alarm going off, a cover open,
 * a lock jammed, unlocked or open, anything else on. */
function alerting(id: string, state: string): boolean {
  switch (domainOf(id)) {
    case "alarm_control_panel":
      return state === "triggered";
    case "cover":
      return state === "open";
    case "lock":
      return state === "jammed" || state === "unlocked" || state === "open";
    default:
      return state === "on";
  }
}

/** An alert's level: the severity chosen, else red for an alarm and the dangers, amber else. */
function levelOf(hass: HomeAssistant, choice: SecurityAlertChoice): AlertLevel {
  if (choice.severity) return choice.severity === "alert" ? "danger" : "warning";
  const domain = domainOf(choice.entity);
  if (domain === "alarm_control_panel") return "danger";
  const deviceClass = hass.states[choice.entity]?.attributes.device_class;
  return domain === "binary_sensor" &&
    typeof deviceClass === "string" &&
    DANGER_CLASSES.has(deviceClass)
    ? "danger"
    : "warning";
}

/**
 * Home Assistant's alerts on now, dangers first. What a private room holds that the viewer may
 * not see (`unseen`, D-039) shows only when it is a danger, as the rooms' alerts do.
 */
export function securityAlerts(
  hass: HomeAssistant,
  choices: readonly SecurityAlertChoice[],
  unseen: Unseen = NOTHING_UNSEEN,
): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  for (const choice of choices) {
    const entity = hass.states[choice.entity];
    if (!entity || !alerting(choice.entity, entity.state)) continue;
    const level = levelOf(hass, choice);
    if (level !== "danger" && !seen(unseen, choice.entity, areaOf(hass, choice.entity))) continue;
    alerts.push({
      entity: choice.entity,
      name: entityName(hass, choice.entity),
      state: hass.formatEntityState?.(entity) ?? entity.state,
      level,
    });
  }
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
}

/** An alert as a banner shows it: a room's (D-023), or one of Home Assistant's. */
export type ShownAlert =
  { kind: "room"; alert: StoreyAlert } | { kind: "security"; alert: SecurityAlert };

/**
 * The rooms' alerts and Home Assistant's together: dangers first, the rooms' first within each
 * level; an entity that raised a room's alert is not said twice.
 */
export function shownAlerts(
  rooms: readonly StoreyAlert[],
  security: readonly SecurityAlert[],
): ShownAlert[] {
  const raised = new Set(rooms.map((alert) => alert.entity));
  const others = security.filter((alert) => !raised.has(alert.entity));
  const shown: ShownAlert[] = [];
  for (const level of ["danger", "warning"] as const) {
    for (const alert of rooms) if (alert.level === level) shown.push({ kind: "room", alert });
    for (const alert of others) if (alert.level === level) shown.push({ kind: "security", alert });
  }
  return shown;
}
