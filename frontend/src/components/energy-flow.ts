/**
 * The home's energy at a glance (D-049): the sun, the grid and the battery around the home, a
 * line where power flows, its dots moving from where the power comes to where it goes, faster
 * the more there is.
 */
import { css, html, nothing, svg, type TemplateResult } from "lit";
import { mdiBattery, mdiHome, mdiTransmissionTower, mdiWeatherSunny } from "@mdi/js";

import type { Translator } from "../i18n";
import type { EnergyFlows, EnergyNow } from "../live/energy";
import { formatPower } from "../live/layers";

/** Where each end stands in the drawing (a 220 × 150 box), and where its words go. */
const AT = {
  solar: { x: 110, y: 16, words: "right" },
  grid: { x: 36, y: 74, words: "below" },
  home: { x: 184, y: 74, words: "below" },
  battery: { x: 110, y: 128, words: "right" },
} as const;
type End = keyof typeof AT;

/** The middle of the drawing, which the lines bend towards. */
const MIDDLE = [110, 74] as const;

/** The colour of the power by where it comes from. */
const FROM: Record<"solar" | "grid" | "battery", string> = {
  solar: "#f2a93b",
  grid: "#5b8def",
  battery: "#3fb37f",
};

/** How long a dot takes along its line (s): quicker with more power, 0.8 s at most power. */
function pace(watts: number): number {
  return Math.max(0.8, Math.min(4, 4 - Math.log10(Math.max(watts, 1)) * 0.9));
}

/** A line from `from` to `to`, a little curved, with its moving dots. */
function line(from: End, to: End, watts: number, color: string): TemplateResult {
  const a = AT[from];
  const b = AT[to];
  // Bent towards the middle of the drawing, so that lines through it do not overlap.
  const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const [cx, cy] = [mx + (MIDDLE[0] - mx) * 0.35, my + (MIDDLE[1] - my) * 0.35];
  const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
  return svg`<path class="wire" d=${d} stroke=${color}></path>
    <path class="flow" d=${d} stroke=${color} style="animation-duration:${pace(watts)}s"></path>`;
}

/** An end: its icon on a disc, and its words (a first line in bold) beside or under it. */
function end(at: End, icon: string, color: string, words: string[]): TemplateResult {
  const { x, y, words: place } = AT[at];
  const right = place === "right";
  const tx = right ? x + 18 : x;
  const ty = right ? y - (words.length - 1) * 6 + 4 : y + 26;
  return svg`<circle cx=${x} cy=${y} r="12" class="disc" stroke=${color}></circle>
    <path d=${icon} transform="translate(${x - 8} ${y - 8}) scale(0.6667)" fill=${color}></path>
    <text x=${tx} y=${ty} text-anchor=${right ? "start" : "middle"}>
      ${words.map(
        (word, k) =>
          svg`<tspan x=${tx} dy=${k === 0 ? 0 : 12} class=${k === 0 ? "value" : ""}>${word}</tspan>`,
      )}
    </text>`;
}

/**
 * The flow of the home's energy: the ends the settings name, the home always; nothing when no
 * sensor says anything.
 */
export function energyFlow(
  t: Translator,
  now: EnergyNow,
  flows: EnergyFlows,
): TemplateResult | typeof nothing {
  const { solar, grid, battery, level } = now;
  if (solar === undefined && grid === undefined && battery === undefined && level === undefined) {
    return nothing;
  }
  const language = t.language;
  const w = (watts: number): string => formatPower(Math.abs(watts), language);
  const lines: TemplateResult[] = [];
  const add = (from: End, to: End, watts: number, color: string): void => {
    if (watts > 0) lines.push(line(from, to, watts, color));
  };
  add("solar", "home", flows.solarToHome, FROM.solar);
  add("solar", "battery", flows.solarToBattery, FROM.solar);
  add("solar", "grid", flows.solarToGrid, FROM.solar);
  add("grid", "home", flows.gridToHome, FROM.grid);
  add("grid", "battery", flows.gridToBattery, FROM.grid);
  add("battery", "home", flows.batteryToHome, FROM.battery);
  add("battery", "grid", flows.batteryToGrid, FROM.battery);
  const gridWords =
    grid === undefined ? [] : [w(grid), t.t(grid < -0.5 ? "energy.to_grid" : "energy.from_grid")];
  const batteryWords = [
    ...(level === undefined ? [] : [`${Math.round(level)} %`]),
    ...(battery === undefined || Math.abs(battery) <= 0.5
      ? []
      : [t.t(battery < 0 ? "energy.charging" : "energy.discharging", { power: w(battery) })]),
  ];
  const homeWords = [w(flows.home), t.t("energy.home")];
  const said = [
    solar === undefined ? "" : t.t("energy.said_solar", { power: w(solar) }),
    t.t("energy.said_home", { power: w(flows.home) }),
    gridWords.join(" "),
    batteryWords.join(", "),
  ]
    .filter(Boolean)
    .join(", ");
  return html`<div class="energy" data-testid="energy" role="img" aria-label=${said}>
    <svg viewBox="0 0 220 150" aria-hidden="true">
      ${lines}
      ${solar === undefined ? nothing : end("solar", mdiWeatherSunny, FROM.solar, [w(solar)])}
      ${grid === undefined ? nothing : end("grid", mdiTransmissionTower, FROM.grid, gridWords)}
      ${
        battery === undefined && level === undefined
          ? nothing
          : end("battery", mdiBattery, FROM.battery, batteryWords)
      }
      ${end("home", mdiHome, "currentColor", homeWords)}
    </svg>
  </div>`;
}

export const energyStyles = css`
  .energy svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    /* Its labels beside their discs, whichever way the language is written (D-082). */
    direction: ltr;
  }
  .energy .disc {
    fill: var(--card-background-color, #fff);
    stroke-width: 1.6;
  }
  .energy text {
    font-size: 10px;
    fill: var(--secondary-text-color, #5f6368);
  }
  .energy text .value {
    font-size: 11px;
    font-weight: 600;
    fill: var(--primary-text-color, #1f1f1f);
  }
  .energy .wire {
    fill: none;
    stroke-width: 1.5;
    opacity: 0.3;
  }
  .energy .flow {
    fill: none;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-dasharray: 0.1 9.9;
    animation: energy-flow linear infinite;
  }
  @keyframes energy-flow {
    from {
      stroke-dashoffset: 10;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .energy .flow {
      animation: none;
      stroke-dasharray: 0.1 5.9;
    }
  }
`;
