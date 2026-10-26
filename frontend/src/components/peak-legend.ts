/**
 * The legend of Hydro-Québec's peaks on the 3D view (D-058): when the peak is and its
 * pre-heating, the colours of what the rooms do, and what they draw.
 */
import { html, nothing, type TemplateResult } from "lit";

import type { Translator } from "../i18n";
import { formatPower } from "../live/layers";
import type { PeakRole, PeakRooms } from "../live/peak-rooms";
import { peakWords, type PeakNow } from "../live/peaks";
import type { TimeStyle } from "../live/schedules";

/** The colour of each role on the floor (`layers.rs`' `PeakRole::color`). */
export const PEAK_COLORS: Record<PeakRole, string> = {
  preheat: "#f29e2e",
  shed: "#2c7bb6",
  heating: "#d7191c",
};

/** The roles a phase shows, in the legend's order. */
const ROLES: Record<PeakNow["phase"], PeakRole[]> = {
  none: [],
  upcoming: [],
  preheat: ["preheat"],
  peak: ["shed", "heating"],
};

/** The legend: the peak in words, the rooms by colour with how many, what they draw. */
export function peakLegend(
  t: Translator,
  now: PeakNow,
  rooms: PeakRooms,
  style: TimeStyle,
  at: Date,
): TemplateResult {
  const words = peakWords(t, now, style, at);
  const roles = Object.values(rooms.roles);
  const keys = ROLES[now.phase].map((role) => ({
    role,
    text: t.tp(`peak.role_${role}`, roles.filter((each) => each === role).length),
  }));
  const draws = Object.values(rooms.draws);
  const drawn =
    draws.length > 0
      ? t.t("peak.draw", {
          power: formatPower(
            draws.reduce((a, b) => a + b, 0),
            t.language,
          ),
        })
      : "";
  const said = [t.t("layers.peak"), ...words, ...keys.map((key) => key.text), drawn]
    .filter(Boolean)
    .join(". ");
  return html`<div
    class="legend glass peak"
    data-testid="legend"
    data-phase=${now.phase}
    role="note"
    aria-label=${said}
  >
    <span class="name" aria-hidden="true">${t.t("layers.peak")}</span>
    ${words.map((word) => html`<span aria-hidden="true">${word}</span>`)}
    ${
      keys.length > 0
        ? html`<ul class="keys" aria-hidden="true">
            ${keys.map(
              (key) =>
                html`<li data-role=${key.role}>
                  <i style="background:${PEAK_COLORS[key.role]}"></i>${key.text}
                </li>`,
            )}
          </ul>`
        : nothing
    }
    ${drawn ? html`<span class="drawn" aria-hidden="true">${drawn}</span>` : nothing}
  </div>`;
}
