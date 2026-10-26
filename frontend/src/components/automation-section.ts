/**
 * The automations of a piece or a room (`DECISIONS.md`, D-032): those Home Assistant relates to
 * its entities, its device or its room's area, each with how the piece takes part, a switch, when
 * it last ran and, for administrators, a link to edit it; and a button that draws their wires.
 * Loaded with the panels that show it, the first time one opens.
 */
import { mdiPencilOutline, mdiVectorPolyline } from "@mdi/js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";

import { nowOf, type HomeAssistant } from "../ha/types";
import { translatorFor, type Translator } from "../i18n";
import { navigate } from "../live/actions";
import {
  readAutomations,
  relatedAutomations,
  rolesOf,
  type ReadAutomation,
  type RelatedItem,
} from "../live/automations";
import { entityName } from "../live/bindings";
import { timeAgo } from "../live/text";
import { define, fire } from "./define";
import { rowStyles, toggle } from "./entity-rows";
import { icon } from "./icon";
import { baseStyles } from "./styles";

/** What the section asks the view: draw the wires of these automations. */
export interface ShowWires {
  ids: string[];
  /** What the section read of them, so that the wires need not ask again. */
  reads: ReadonlyMap<string, ReadAutomation>;
}

/** `<domotwin-automations>`: the automations a piece or a room takes part in. */
export class DomoTwinAutomations extends LitElement {
  static override properties = {
    hass: { attribute: false },
    entities: { attribute: false },
    device: { attribute: false },
    area: { attribute: false },
    ids: { state: true },
    reads: { state: true },
    unread: { state: true },
  };
  static override styles = [
    baseStyles,
    rowStyles,
    css`
      :host {
        display: block;
      }
      h3 {
        margin: 12px 0 0;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--secondary-text-color, #5f6368);
      }
      .automation {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 48px;
      }
      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .text small {
        color: var(--secondary-text-color, #5f6368);
      }
      .role {
        display: inline-block;
        margin-right: 4px;
        padding: 0 6px;
        border-radius: 8px;
        font-size: 0.72rem;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 16%, transparent);
      }
      a.edit {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: inherit;
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        padding-top: 4px;
      }
      p.empty {
        color: var(--secondary-text-color, #5f6368);
        margin: 8px 0;
      }
    `,
  ];

  hass?: HomeAssistant;
  /** What the piece or room is: its entities, its device, its (room's) area. */
  entities: string[] = [];
  device?: string;
  area?: string;
  /** The automations found (none yet: still looking). */
  protected ids?: string[];
  /** What each one involves, when its configuration could be read. */
  protected reads = new Map<string, ReadAutomation>();
  /** The configurations came, but the module that reads them could not be loaded. */
  protected unread = false;
  private asked = "";

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  protected override willUpdate(): void {
    if (!this.hass) return;
    const items: RelatedItem[] = [
      ...this.entities.map((id) => ({ type: "entity" as const, id })),
      ...(this.device ? [{ type: "device" as const, id: this.device }] : []),
      ...(this.area ? [{ type: "area" as const, id: this.area }] : []),
    ];
    const key = JSON.stringify(items);
    if (key !== this.asked) {
      this.asked = key;
      void this.load(this.hass, items, key);
    }
  }

  private async load(hass: HomeAssistant, items: RelatedItem[], key: string): Promise<void> {
    this.ids = undefined;
    const ids = await relatedAutomations(hass, items);
    const reads = await readAutomations(hass, ids);
    // Asked for something else meanwhile: that answer counts.
    if (key !== this.asked) return;
    this.reads = reads ?? new Map<string, ReadAutomation>();
    this.unread = reads === undefined;
    this.ids = ids;
  }

  private ago(id: string): string {
    const t = this.t;
    const at = this.hass?.states[id]?.attributes.last_triggered;
    const time = typeof at === "string" ? Date.parse(at) : NaN;
    if (!Number.isFinite(time)) return t.t("automations.never");
    return t.t("automations.ran", {
      when: timeAgo(t.language, Math.max(0, (nowOf(this.hass) - time) / 1000)),
    });
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = this.t;
    const ids = this.ids;
    const admin = hass.user?.is_admin === true;
    const piece = { entities: this.entities, device: this.device, area: this.area };
    const body =
      ids === undefined
        ? html`<p class="empty">${t.t("automations.loading")}</p>`
        : ids.length === 0
          ? html`<p class="empty">${t.t("automations.none")}</p>`
          : html`${ids.map((id) => {
              const state = hass.states[id];
              const name = entityName(hass, id);
              const read = this.reads.get(id);
              const roles = read ? rolesOf(read.ends, piece) : [];
              const editId = state?.attributes.id;
              return html`<div class="automation" data-automation=${id}>
                <span class="text">
                  <span>${name}</span>
                  <small
                    >${roles.map(
                      (role) => html`<span class="role">${t.t(`automations.role.${role}`)}</span>`,
                    )}${this.ago(id)}</small
                  >
                </span>
                ${
                  admin && !hass.demo && typeof editId === "string"
                    ? html`<a
                        class="edit"
                        href=${`/config/automation/edit/${encodeURIComponent(editId)}`}
                        title=${t.t("automations.edit", { name })}
                        aria-label=${t.t("automations.edit", { name })}
                        @click=${(event: Event) => {
                          event.preventDefault();
                          navigate(`/config/automation/edit/${encodeURIComponent(editId)}`);
                        }}
                        >${icon(mdiPencilOutline)}</a
                      >`
                    : nothing
                }
                ${toggle(hass, t, id, state?.state === "on", state?.state === "unavailable")}
              </div>`;
            })}`;
    const drawable = ids?.filter((id) => this.reads.has(id)) ?? [];
    return html`<section data-testid="automations">
      <h3>${t.t("automations.title")}</h3>
      ${body}
      ${
        drawable.length > 0
          ? html`<div class="footer">
              <button
                class="action quiet"
                data-testid="show-wires"
                @click=${() => {
                  fire(this, "domotwin-show-wires", {
                    ids: drawable,
                    reads: this.reads,
                  } satisfies ShowWires);
                }}
              >
                ${icon(mdiVectorPolyline)}${t.t("automations.show_wires")}
              </button>
            </div>`
          : this.unread
            ? html`<p class="empty" role="alert">${t.t("automations.unread")}</p>`
            : ids && ids.length > 0 && drawable.length === 0
              ? html`<p class="empty">${t.t("automations.admin_only")}</p>`
              : nothing
      }
    </section>`;
  }
}

define("domotwin-automations", DomoTwinAutomations);
