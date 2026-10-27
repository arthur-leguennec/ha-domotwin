/**
 * What the wires drawn with the automations' wire set show over the view (D-032, D-059): the
 * spots their ends are at, marked by role, or labelled where nothing stands there, lifted apart
 * where they would cover one another; and the chip at the top that names them.
 */
import { mdiHelpRhombusOutline, mdiLightningBolt, mdiTarget } from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";

import type { Translator } from "../i18n";
import { icon } from "./icon";

/** A spot the engine draws an end at (`setAutomations`). */
export interface Spot {
  piece?: string;
  room?: string | null;
  above?: string;
  roles: ("trigger" | "condition" | "action")[];
  automations: number[];
  dynamic: boolean;
}

const ROLE_ICONS = {
  trigger: mdiLightningBolt,
  condition: mdiHelpRhombusOutline,
  action: mdiTarget,
};

/** About how wide a label is drawn (CSS pixels), and how tall; half an end marker's size. */
const labelWidth = (text: string): number => text.length * 7 + 18;
const LABEL_HEIGHT = 22;
const MARKER_HALF = 12;

/**
 * The labels' places, each lifted above what it would cover (labels side by side in the home can
 * line up on screen, or fall on an end's marker): markers (`texts` undefined) stay where they
 * are; from the lowest on screen up, a label overlapping a marker or a label already placed goes
 * just above it.
 */
export function lift(
  points: ([number, number] | null)[],
  texts: readonly (string | undefined)[],
): ([number, number] | null)[] {
  const out = points.map((p) => (p ? ([p[0], p[1]] as [number, number]) : null));
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  out.forEach((p, i) => {
    if (p && texts[i] === undefined) {
      const [x, y] = p;
      const h = MARKER_HALF;
      placed.push({ left: x - h, right: x + h, top: y - h, bottom: y + h });
    }
  });
  const order = out
    .map((p, i) => ({ p, i, text: texts[i] }))
    .filter((e): e is { p: [number, number]; i: number; text: string } => !!e.p && !!e.text)
    .sort((a, b) => b.p[1] - a.p[1]);
  for (const { p, text } of order) {
    const half = labelWidth(text) / 2;
    let moved = true;
    while (moved) {
      moved = false;
      for (const box of placed) {
        const overlaps =
          p[0] - half < box.right &&
          p[0] + half > box.left &&
          p[1] - LABEL_HEIGHT < box.bottom &&
          p[1] > box.top;
        if (overlaps) {
          p[1] = box.top - 2;
          moved = true;
        }
      }
    }
    placed.push({ left: p[0] - half, right: p[0] + half, top: p[1] - LABEL_HEIGHT, bottom: p[1] });
  }
  return out;
}

/** Where each spot is drawn on screen now (CSS pixels, `scale` per device pixel), labels lifted
 * apart: the engine's `automationPoints` read. */
export function spotPoints(
  text: string,
  scale: number,
  texts: readonly (string | undefined)[],
): ([number, number] | null)[] {
  const points = JSON.parse(text) as ([number, number] | null)[];
  return lift(
    points.map((p) => (p ? [p[0] * scale, p[1] * scale] : null)),
    texts,
  );
}

/** The spots: a marker of the roles at each piece or room, a label where `text` gives one. */
export function renderSpots(
  t: Translator,
  spots: readonly Spot[],
  points: readonly ([number, number] | null)[],
  text: (spot: Spot) => string | undefined,
): TemplateResult {
  return html`${spots.map((spot, i) => {
    const p = points[i];
    if (!p) return nothing;
    const style = `left:${p[0]}px;top:${p[1]}px`;
    const dynamic = spot.dynamic ? "dynamic" : "";
    const label = text(spot);
    if (label !== undefined) {
      return html`<span class="label ${dynamic}" style=${style}>${label}</span>`;
    }
    return html`<span
      class="end ${dynamic}"
      style=${style}
      title=${spot.roles.map((r) => t.t(`automations.role.${r}`)).join(" · ")}
      >${spot.roles.map((r) => icon(ROLE_ICONS[r]))}</span
    >`;
  })}`;
}

/** The colour of a swatch (linear RGB, 0–1) as CSS. */
export function swatchColor(color: readonly number[]): string {
  return `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
}

export const spotStyles = css`
  :host {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }
  .end {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--card-background-color, #fff) 88%, transparent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    color: var(--primary-text-color, #1f2328);
  }
  .end svg {
    width: 14px;
    height: 14px;
  }
  .end.dynamic,
  .label.dynamic {
    outline: 2px dashed var(--secondary-text-color, #5f6368);
    outline-offset: 1px;
  }
  .label {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
    white-space: nowrap;
    background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    color: var(--primary-text-color, #1f2328);
  }
  .chip {
    position: absolute;
    inset-inline-start: 12px;
    top: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 92px);
    padding-block: 4px;
    padding-inline: 12px 4px;
    border-radius: 18px;
    pointer-events: auto;
    font-size: 0.85rem;
  }
  .chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip .swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .chip button {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
`;
