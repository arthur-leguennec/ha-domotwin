/**
 * Rows that control one Home Assistant entity, shared by the long-press controls and the room
 * panel: a light's switch, brightness, colour temperature and colours; a cover's buttons and
 * position; a media player's buttons and volume; a fan, a switch, a lock, a thermostat, a robot
 * vacuum, a button, a scene.
 */
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiHomeImportOutline,
  mdiLock,
  mdiLockOpenVariant,
  mdiMinus,
  mdiPause,
  mdiPlay,
  mdiPlayPause,
  mdiPlus,
  mdiPower,
  mdiSkipNext,
  mdiSkipPrevious,
  mdiStop,
  mdiVolumeMinus,
  mdiVolumeOff,
  mdiVolumePlus,
} from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";

import type { HassEntity, HomeAssistant } from "../ha/types";
import type { Translator } from "../i18n";
import { entityName } from "../live/bindings";
import { icon } from "./icon";

/** A few colours to pick from (sRGB). */
const SWATCHES: readonly [number, number, number][] = [
  [255, 214, 160],
  [255, 255, 255],
  [255, 140, 70],
  [255, 80, 80],
  [255, 105, 180],
  [150, 110, 255],
  [80, 140, 255],
  [80, 220, 160],
];

function call(
  hass: HomeAssistant,
  domain: string,
  service: string,
  entityId: string,
  data: Record<string, unknown> = {},
): void {
  void hass.callService(domain, service, data, { entity_id: entityId }).catch(() => undefined);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function modes(entity: HassEntity): string[] {
  const value = entity.attributes.supported_color_modes;
  return Array.isArray(value) ? value.filter((m): m is string => typeof m === "string") : [];
}

/** A switch that turns an entity on or off. */
export function toggle(
  hass: HomeAssistant,
  t: Translator,
  entityId: string,
  on: boolean,
  disabled: boolean,
): TemplateResult {
  return html`<button
    class="switch ${on ? "on" : ""}"
    role="switch"
    aria-checked=${on ? "true" : "false"}
    aria-label=${entityName(hass, entityId)}
    title=${t.t(on ? "controls.turn_off" : "controls.turn_on")}
    ?disabled=${disabled}
    @click=${() => {
      call(hass, "homeassistant", on ? "turn_off" : "turn_on", entityId);
    }}
  >
    <span class="knob"></span>
  </button>`;
}

function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
  disabled: boolean,
): TemplateResult {
  return html`<label class="slider">
    <span>${label}</span>
    <input
      type="range"
      min=${min}
      max=${max}
      step=${step}
      .value=${String(value)}
      ?disabled=${disabled}
      @change=${(event: Event) => {
        onChange(Number((event.target as HTMLInputElement).value));
      }}
    />
  </label>`;
}

function button(
  path: string,
  label: string,
  onClick: () => void,
  disabled = false,
): TemplateResult {
  return html`<button
    class="round"
    aria-label=${label}
    title=${label}
    ?disabled=${disabled}
    @click=${onClick}
  >
    ${icon(path)}
  </button>`;
}

/** The state shown next to an entity's name. */
function stateText(t: Translator, entity: HassEntity): string {
  if (entity.state === "unavailable" || entity.state === "unknown")
    return t.t("controls.unavailable");
  const unit = entity.attributes.unit_of_measurement;
  return typeof unit === "string" ? `${entity.state} ${unit}` : entity.state;
}

/**
 * A row for an entity; `full` adds sliders and colours (long-press controls). An entity the
 * viewer may only look at (their rights, D-070) has its controls shown, disabled.
 */
export function entityRow(
  hass: HomeAssistant,
  t: Translator,
  entityId: string,
  full: boolean,
): TemplateResult {
  const row = controlRow(hass, t, entityId, full);
  return hass.canAct?.(entityId) === false
    ? html`<fieldset class="look" disabled title=${t.t("controls.look_only")}>${row}</fieldset>`
    : row;
}

function controlRow(
  hass: HomeAssistant,
  t: Translator,
  entityId: string,
  full: boolean,
): TemplateResult {
  const entity = hass.states[entityId];
  const name = entityName(hass, entityId);
  if (!entity) {
    return html`<div class="row" role="group" aria-label=${name}>
      <span class="name">${name}</span><span class="state">${t.t("controls.unavailable")}</span>
    </div>`;
  }
  const domain = entityId.split(".")[0];
  const off = entity.state === "unavailable" || entity.state === "unknown";
  const head = (controls: TemplateResult | typeof nothing): TemplateResult =>
    html`<div class="head"><span class="name">${name}</span>${controls}</div>`;
  switch (domain) {
    case "light": {
      const on = entity.state === "on";
      const supported = modes(entity);
      const dims = supported.some((m) => m !== "onoff");
      const brightness = number(entity.attributes.brightness) ?? 255;
      const kelvin = number(entity.attributes.color_temp_kelvin);
      const minK = number(entity.attributes.min_color_temp_kelvin) ?? 2000;
      const maxK = number(entity.attributes.max_color_temp_kelvin) ?? 6500;
      const colours = supported.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m));
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(toggle(hass, t, entityId, on, off))}
        ${
          full && on && dims
            ? slider(
                t.t("controls.brightness"),
                Math.round(brightness / 2.55),
                1,
                100,
                1,
                (v) => {
                  call(hass, "light", "turn_on", entityId, { brightness_pct: v });
                },
                off,
              )
            : nothing
        }
        ${
          full && on && supported.includes("color_temp")
            ? slider(
                t.t("controls.color_temp"),
                kelvin ?? minK,
                minK,
                maxK,
                50,
                (v) => {
                  call(hass, "light", "turn_on", entityId, { color_temp_kelvin: v });
                },
                off,
              )
            : nothing
        }
        ${
          full && on && colours
            ? html`<div class="swatches" role="group" aria-label=${t.t("controls.color")}>
                ${SWATCHES.map(
                  (rgb) =>
                    html`<button
                      class="swatch"
                      style="background: rgb(${rgb.join(",")})"
                      aria-label=${`${t.t("controls.color")} ${rgb.join(", ")}`}
                      @click=${() => {
                        call(hass, "light", "turn_on", entityId, { rgb_color: rgb });
                      }}
                    ></button>`,
                )}
              </div>`
            : nothing
        }
      </div>`;
    }
    case "switch":
    case "input_boolean":
    case "humidifier":
    case "siren":
    case "fan": {
      const on = entity.state === "on";
      const percentage = number(entity.attributes.percentage);
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(toggle(hass, t, entityId, on, off))}
        ${
          full && on && domain === "fan" && percentage !== undefined
            ? slider(
                t.t("controls.speed"),
                percentage,
                0,
                100,
                1,
                (v) => {
                  call(hass, "fan", "set_percentage", entityId, { percentage: v });
                },
                off,
              )
            : nothing
        }
      </div>`;
    }
    case "cover": {
      const position = number(entity.attributes.current_position);
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<span class="buttons">
            ${button(
              mdiArrowUp,
              t.t("controls.open"),
              () => {
                call(hass, "cover", "open_cover", entityId);
              },
              off,
            )}
            ${button(
              mdiStop,
              t.t("controls.stop"),
              () => {
                call(hass, "cover", "stop_cover", entityId);
              },
              off,
            )}
            ${button(
              mdiArrowDown,
              t.t("controls.close"),
              () => {
                call(hass, "cover", "close_cover", entityId);
              },
              off,
            )}
          </span>`,
        )}
        ${
          full && position !== undefined
            ? slider(
                t.t("controls.position"),
                position,
                0,
                100,
                1,
                (v) => {
                  call(hass, "cover", "set_cover_position", entityId, { position: v });
                },
                off,
              )
            : nothing
        }
      </div>`;
    }
    case "media_player": {
      const volume = number(entity.attributes.volume_level);
      const playing = entity.state === "playing";
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<span class="buttons">
            ${
              full
                ? button(
                    mdiSkipPrevious,
                    t.t("controls.previous"),
                    () => {
                      call(hass, "media_player", "media_previous_track", entityId);
                    },
                    off,
                  )
                : nothing
            }
            ${button(
              mdiPlayPause,
              t.t(playing ? "controls.pause" : "controls.play"),
              () => {
                call(hass, "media_player", "media_play_pause", entityId);
              },
              off,
            )}
            ${
              full
                ? button(
                    mdiSkipNext,
                    t.t("controls.next"),
                    () => {
                      call(hass, "media_player", "media_next_track", entityId);
                    },
                    off,
                  )
                : nothing
            }
            ${button(
              mdiPower,
              t.t("controls.power"),
              () => {
                call(hass, "media_player", "toggle", entityId);
              },
              off,
            )}
          </span>`,
        )}
        ${
          full && volume !== undefined
            ? slider(
                t.t("controls.volume"),
                Math.round(volume * 100),
                0,
                100,
                1,
                (v) => {
                  call(hass, "media_player", "volume_set", entityId, { volume_level: v / 100 });
                },
                off,
              )
            : nothing
        }
      </div>`;
    }
    case "lock": {
      const locked = entity.state === "locked";
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<span class="state">${stateText(t, entity)}</span> ${button(
              locked ? mdiLockOpenVariant : mdiLock,
              t.t(locked ? "controls.unlock" : "controls.lock"),
              () => {
                call(hass, "lock", locked ? "unlock" : "lock", entityId);
              },
              off,
            )}`,
        )}
      </div>`;
    }
    case "climate": {
      const target = number(entity.attributes.temperature);
      const current = number(entity.attributes.current_temperature);
      const step = number(entity.attributes.target_temp_step) ?? 0.5;
      const set = (value: number) => {
        call(hass, "climate", "set_temperature", entityId, { temperature: value });
      };
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<span class="state"
              >${current !== undefined ? `${current}°` : stateText(t, entity)}</span
            >
            ${
              target !== undefined
                ? html`<span class="buttons">
                    ${button(
                      mdiMinus,
                      t.t("controls.colder"),
                      () => {
                        set(target - step);
                      },
                      off,
                    )}
                    <span class="target">${target}°</span>
                    ${button(
                      mdiPlus,
                      t.t("controls.warmer"),
                      () => {
                        set(target + step);
                      },
                      off,
                    )}
                  </span>`
                : nothing
            }`,
        )}
      </div>`;
    }
    case "vacuum":
    case "lawn_mower": {
      const vacuum = domain === "vacuum";
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<span class="state">${stateText(t, entity)}</span>
            <span class="buttons">
              ${button(
                mdiPlay,
                t.t("controls.start"),
                () => {
                  call(hass, domain, vacuum ? "start" : "start_mowing", entityId);
                },
                off,
              )}
              ${button(
                mdiPause,
                t.t("controls.pause"),
                () => {
                  call(hass, domain, "pause", entityId);
                },
                off,
              )}
              ${button(
                mdiHomeImportOutline,
                t.t("controls.home"),
                () => {
                  call(hass, domain, vacuum ? "return_to_base" : "dock", entityId);
                },
                off,
              )}
            </span>`,
        )}
      </div>`;
    }
    case "button":
    case "input_button":
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<button
            class="action quiet small"
            ?disabled=${off}
            @click=${() => {
              call(hass, domain, "press", entityId);
            }}
          >
            ${t.t("controls.press")}
          </button>`,
        )}
      </div>`;
    case "scene":
    case "script":
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(
          html`<button
            class="action quiet small"
            @click=${() => {
              call(hass, domain, "turn_on", entityId);
            }}
          >
            ${t.t("controls.activate")}
          </button>`,
        )}
      </div>`;
    default:
      return html`<div class="row" role="group" aria-label=${name}>
        ${head(html`<span class="state">${stateText(t, entity)}</span>`)}
      </div>`;
  }
}

/**
 * What a tap's bubble adds to an entity's row (D-047): a light's brightness or a fan's speed while
 * it is on, a blind's position, a player's volume down and up.
 */
export function quickControls(
  hass: HomeAssistant,
  t: Translator,
  entityId: string,
): TemplateResult | typeof nothing {
  const entity = hass.states[entityId];
  if (!entity || entity.state === "unavailable" || entity.state === "unknown") return nothing;
  // Only looked at (D-070): its row says so.
  if (hass.canAct?.(entityId) === false) return nothing;
  const domain = entityId.split(".")[0];
  if (domain === "light" && entity.state === "on" && modes(entity).some((m) => m !== "onoff")) {
    return slider(
      t.t("controls.brightness"),
      Math.round((number(entity.attributes.brightness) ?? 255) / 2.55),
      1,
      100,
      1,
      (v) => {
        call(hass, "light", "turn_on", entityId, { brightness_pct: v });
      },
      false,
    );
  }
  const percentage = number(entity.attributes.percentage);
  if (domain === "fan" && entity.state === "on" && percentage !== undefined) {
    return slider(
      t.t("controls.speed"),
      percentage,
      0,
      100,
      1,
      (v) => {
        call(hass, "fan", "set_percentage", entityId, { percentage: v });
      },
      false,
    );
  }
  const position = number(entity.attributes.current_position);
  if (domain === "cover" && position !== undefined) {
    return slider(
      t.t("controls.position"),
      position,
      0,
      100,
      1,
      (v) => {
        call(hass, "cover", "set_cover_position", entityId, { position: v });
      },
      false,
    );
  }
  if (domain === "media_player" && entity.state !== "off") {
    return html`<div class="buttons quick" role="group" aria-label=${t.t("controls.volume")}>
      ${button(mdiVolumeMinus, t.t("controls.volume_down"), () => {
        call(hass, "media_player", "volume_down", entityId);
      })}
      ${button(mdiVolumeOff, t.t("controls.mute"), () => {
        call(hass, "media_player", "volume_mute", entityId, {
          is_volume_muted: entity.attributes.is_volume_muted !== true,
        });
      })}
      ${button(mdiVolumePlus, t.t("controls.volume_up"), () => {
        call(hass, "media_player", "volume_up", entityId);
      })}
    </div>`;
  }
  return nothing;
}

/** Styles of the rows. */
export const rowStyles = css`
  fieldset.look {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
  }
  fieldset.look:not(:last-child) .row {
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
  }
  .row {
    display: grid;
    gap: 6px;
    padding: 8px 0;
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
  }
  .row:last-child {
    border-bottom: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state,
  .target {
    color: var(--secondary-text-color, #5f6368);
    font-variant-numeric: tabular-nums;
  }
  .buttons {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  button.round {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--primary-text-color, #1f2328) 7%, transparent);
    color: var(--primary-text-color, #1f2328);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.switch {
    position: relative;
    width: 48px;
    height: 28px;
    border: none;
    border-radius: 14px;
    background: color-mix(in srgb, var(--primary-text-color, #1f2328) 22%, transparent);
    cursor: pointer;
    flex: none;
  }
  button.switch.on {
    background: var(--primary-color, #03a9f4);
  }
  button.switch .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    transition: transform 150ms ease;
  }
  button.switch.on .knob {
    transform: translateX(20px);
  }
  .slider {
    display: grid;
    grid-template-columns: 7.5em 1fr;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    color: var(--secondary-text-color, #5f6368);
  }
  .slider input {
    width: 100%;
    accent-color: var(--primary-color, #03a9f4);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--primary-text-color, #1f2328) 15%, transparent);
    cursor: pointer;
  }
  button.action.small {
    min-height: 32px;
    padding: 0 12px;
  }
`;
