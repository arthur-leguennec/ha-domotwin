/**
 * An alert's button (D-064), in the 3D view's banner and above the other tabs alike: a room's
 * frames its room (`frame`), Home Assistant's opens its Security page (`page`).
 */
import { mdiAlert, mdiAlertCircleOutline } from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";

import type { StoreyInfo } from "../ha/client";
import type { Translator } from "../i18n";
import { navigate } from "../live/actions";
import type { ShownAlert } from "../live/security";
import { alertText, type StoreyAlert } from "../live/storeys";
import { icon } from "./icon";

/** The room of an alert to frame, on its storey. */
export type AlertRoom = Pick<StoreyAlert, "room" | "name" | "storey">;

/** One alert's button, of the class `look` and the alert's level. */
export function alertButton(
  t: Translator,
  { kind, alert }: ShownAlert,
  storeys: readonly Pick<StoreyInfo, "id" | "name" | "elevation">[],
  page: string | undefined,
  frame: (room: AlertRoom) => void,
  look: string,
): TemplateResult {
  const glyph = icon(alert.level === "danger" ? mdiAlert : mdiAlertCircleOutline);
  if (kind === "room") {
    return html`<button
      class="${look} ${alert.level}"
      data-room=${alert.room}
      data-storey=${alert.storey ?? nothing}
      @click=${() => {
        frame(alert.storey ? { room: alert.room, name: alert.name, storey: alert.storey } : alert);
      }}
    >
      ${glyph}<span>${alertText(t, alert, storeys)}</span>
    </button>`;
  }
  return html`<button
    class="${look} ${alert.level}"
    data-entity=${alert.entity}
    ?disabled=${!page}
    @click=${() => {
      if (page) navigate(page);
    }}
  >
    ${glyph}<span>${t.t("layers.alert_entity", { name: alert.name, state: alert.state })}</span>
  </button>`;
}
