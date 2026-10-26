/**
 * What a room does with a tap (`DECISIONS.md`, D-047), as buttons: over the view when the room is
 * framed (icons), and in its panel (icons and words).
 */
import {
  mdiBlindsHorizontal,
  mdiBlindsHorizontalClosed,
  mdiGestureTap,
  mdiLightbulbOff,
  mdiLightbulbOn,
  mdiTelevisionOff,
} from "@mdi/js";
import { css, html, type TemplateResult } from "lit";

import type { Translator } from "../i18n";
import type { RoomAction, RoomCommand, RoomCommandKey } from "../live/room-actions";
import { icon } from "./icon";

export const COMMAND_ICONS: Readonly<Record<RoomCommandKey, string>> = {
  lights_on: mdiLightbulbOn,
  lights_off: mdiLightbulbOff,
  covers_open: mdiBlindsHorizontal,
  covers_close: mdiBlindsHorizontalClosed,
  media_off: mdiTelevisionOff,
};

/** An action an administrator gave the room. */
export const ROOM_ACTION_ICON = mdiGestureTap;

/**
 * A room's buttons: what it does together, then its own actions. On its chip (`words` off) its
 * commands are icons; its own actions always have their names.
 */
export function roomButtons(
  t: Translator,
  commands: readonly RoomCommand[],
  actions: readonly RoomAction[],
  run: (what: RoomCommand | RoomAction) => void,
  words: boolean,
): TemplateResult {
  return html`${commands.map((command) => {
    const label = t.t(command.label);
    return words
      ? html`<button class="pill" data-command=${command.key} @click=${() => run(command)}>
          ${icon(COMMAND_ICONS[command.key])}<span>${label}</span>
        </button>`
      : html`<button
          class="round"
          data-command=${command.key}
          aria-label=${label}
          title=${label}
          @click=${() => run(command)}
        >
          ${icon(COMMAND_ICONS[command.key])}
        </button>`;
  })}
  ${actions.map(
    (entry, index) =>
      html`<button class="pill" data-room-action=${index} @click=${() => run(entry)}>
        ${icon(ROOM_ACTION_ICON)}<span>${entry.name}</span>
      </button>`,
  )}`;
}

export const roomBarStyles = css`
  .room-commands {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  button.pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    max-width: 100%;
    padding: 0 12px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 18px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.pill:hover {
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  button.pill svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
`;
