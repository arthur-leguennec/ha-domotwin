/**
 * `<domotwin-link>`: links one element of the plan to Home Assistant (administrators, from the
 * panel's link mode). An element gets entities (suggested from its room's area, or searched), the
 * role of each, a tap action and a long-press action; a room gets an area and actions of its own
 * (D-047). An action is first one of the plain actions of the devices linked (switch on, volume
 * up, open…); the advanced mode adds any Home Assistant action with its data, and a page. Saving
 * is the panel's job (`domotwin-link-save`).
 */
import { mdiClose, mdiPlus } from "@mdi/js";
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import type { HomeAssistant } from "../ha/types";
import {
  ADVANCED_CHOICES,
  actionDraft,
  draftAction,
  parseData,
  validPath,
  validService,
  type ActionChoice,
  type ActionDraft,
} from "../live/action-choice";
import {
  deriveRole,
  entityName,
  primaryEntity,
  roleOf,
  tapAction,
  type Action,
  type BoundEntity,
  type ElementBinding,
  type Role,
  type RoomAction,
} from "../live/bindings";
import { presetKey, presets } from "../live/presets";
import {
  MAX_ACTION_NAME,
  MAX_ROOM_ACTIONS,
  devicesFrom,
  presentDevices,
  type RoomDevices,
} from "../live/room-actions";
import {
  searchEntities,
  suggestions,
  type LinkChange,
  type PlanElementInfo,
} from "../live/suggest";
import type { MessageKey, Translator } from "../i18n";
import { define, fire } from "./define";
import { rowStyles } from "./entity-rows";
import { icon } from "./icon";
import { Sheet, sheetStyles } from "./sheet";
import { baseStyles } from "./styles";

const ROLES: readonly Role[] = [
  "light",
  "switch",
  "fan",
  "cover",
  "media",
  "contact",
  "lock",
  "camera",
  "power",
  "climate",
  "sensor",
];

/** What a camera sees: its angle of view (degrees) and reach (cm), with their limits. */
const VIEW_FIELDS = [
  ["fov", 10, 180, 90],
  ["range", 50, 3000, 600],
] as const;

/** A view field typed by the user: empty (the default) or a number within its limits. */
function viewValue(text: string, low: number, high: number): number | undefined | null {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= low && value <= high ? value : null;
}

/** The choices besides the plain actions: a piece's, then those of the advanced mode. */
const PIECE_CHOICES: readonly [ActionChoice, MessageKey][] = [
  ["controls", "link.action_controls"],
  ["more-info", "link.action_more_info"],
  ["none", "link.action_none"],
];
const ADVANCED: readonly [ActionChoice, MessageKey][] = [
  ["toggle", "link.action_toggle"],
  ["perform-action", "link.action_perform"],
  ["navigate", "link.action_navigate"],
];

/** A room's action as edited: its name, what it does, what it was and if only as written. */
interface RoomActionDraft {
  name: string;
  draft: ActionDraft;
  original?: Action;
  written: boolean;
}

/** What one action editor needs: where it is, its draft, and what it may offer. */
interface ActionField {
  /** The test id of its choice (`link-tap`, `room-action-0`…), the start of its fields'. */
  id: string;
  label: string;
  draft: ActionDraft;
  set: (patch: Partial<ActionDraft>) => void;
  /** The entities whose plain actions are offered, and those a "Run an action" may target. */
  entities: readonly string[];
  /** A piece's: the automatic choice (its words) and DomoTwin's, and its main device. */
  auto?: string;
  primary?: string;
  piece: boolean;
  /** The stored action, and whether the editor shows it only as written. */
  original?: Action;
  written: boolean;
}

export class DomoTwinLink extends Sheet {
  static override properties = {
    ...Sheet.properties,
    element: { attribute: false },
    binding: { attribute: false },
    area: { attribute: false },
    roomArea: { attribute: false },
    roomActions: { attribute: false },
    pieceEntities: { attribute: false },
    busy: { attribute: false },
    entities: { state: true },
    advanced: { state: true },
    actions: { state: true },
    device: { state: true },
    tap: { state: true },
    hold: { state: true },
    chosenArea: { state: true },
    query: { state: true },
    fov: { state: true },
    range: { state: true },
  };
  static override styles = [
    baseStyles,
    rowStyles,
    sheetStyles,
    css`
      .entity {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
      }
      .entity .text {
        flex: 1;
        min-width: 0;
        display: grid;
      }
      .entity small,
      .hint {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.8rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hint {
        white-space: normal;
        margin: 6px 0 0;
      }
      input,
      select {
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        margin-top: 6px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      select.role {
        width: auto;
        max-width: 100%;
        min-height: 30px;
        margin-top: 2px;
        padding: 0 6px;
        font-size: 0.8rem;
      }
      .field {
        display: block;
        margin-top: 8px;
        font-size: 0.85rem;
      }
      .hint.error {
        color: var(--error-color, #db4437);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 64px;
        margin-top: 6px;
        padding: 8px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font:
          0.85rem ui-monospace,
          monospace;
        resize: vertical;
      }
      label.advanced {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-height: 44px;
        margin-top: 12px;
        cursor: pointer;
      }
      label.advanced input {
        flex: none;
        width: 20px;
        height: 20px;
        min-height: 0;
        margin: 2px 0 0;
      }
      label.advanced span {
        display: grid;
      }
      .room-action {
        margin-top: 10px;
        padding: 4px 10px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
      }
      .room-action .entity {
        min-height: 40px;
      }
      .room-action .entity input {
        flex: 1;
        margin-top: 0;
      }
    `,
  ];

  /** The element being linked. */
  element?: PlanElementInfo;
  /** Its current binding (elements). */
  binding?: ElementBinding;
  /** Its current area (rooms). */
  area?: string;
  /** The area of the room the element is in, for suggestions (or found by the room's name). */
  roomArea?: string;
  /** A room's actions as stored, and the entities linked to its pieces (their plain actions). */
  roomActions: RoomAction[] = [];
  pieceEntities: string[] = [];
  /** Saving: the buttons wait. */
  busy = false;

  protected entities: BoundEntity[] = [];
  /** The Home Assistant device the element stands for (the network map, D-031). */
  protected device = "";
  protected tap: ActionDraft = actionDraft(undefined);
  protected hold: ActionDraft = actionDraft(undefined);
  protected chosenArea = "";
  protected query = "";
  /** A linked camera's angle of view and reach, as typed (empty: the default). */
  protected fov = "";
  protected range = "";
  /** The advanced mode: any Home Assistant action, a page. */
  protected advanced = false;
  /** A room's actions being edited. */
  protected actions: RoomActionDraft[] = [];
  private devicesMemo?: {
    entities: HomeAssistant["entities"];
    area: string | undefined;
    pieces: string[];
    value: RoomDevices;
  };

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("element") || changed.has("binding") || changed.has("area")) {
      this.entities = [...(this.binding?.entities ?? [])];
      this.device = this.binding?.device ?? "";
      this.chosenArea = this.area ?? (this.element?.type === "room" ? (this.roomArea ?? "") : "");
      const ids = this.linkedIds;
      const primary = this.primary;
      this.tap = actionDraft(this.binding?.tap_action, ids, primary);
      this.hold = actionDraft(this.binding?.hold_action, ids, primary);
      const devices = this.roomDevices;
      this.actions = this.roomActions.map((entry) => {
        const draft = actionDraft(entry.action, devices);
        // What a room's action list does not offer (a toggle, nothing…) stays as written.
        const offered = ["preset", "perform-action", "navigate"].includes(draft.choice);
        return {
          name: entry.name,
          draft: offered ? draft : { ...draft, choice: "custom" },
          original: entry.action,
          written: !offered,
        };
      });
      // An action the plain choices cannot show opens the advanced mode.
      this.advanced = [this.tap, this.hold, ...this.actions.map((a) => a.draft)].some((d) =>
        ADVANCED_CHOICES.has(d.choice),
      );
      this.query = "";
      this.fov = this.binding?.fov?.toString() ?? "";
      this.range = this.binding?.range?.toString() ?? "";
    }
  }

  /** The entities linked to the piece. */
  private get linkedIds(): string[] {
    return this.entities.map((entity) => entity.entity_id);
  }

  /** The piece's main device: what a bare toggle acts on. */
  private get primary(): string | undefined {
    return primaryEntity({ entities: this.entities }, this.hass);
  }

  /**
   * A room's devices, whose plain actions its own actions offer: those of the area chosen and of
   * its pieces, as the room's buttons read them. Read from the registry again only when it, the
   * area or the pieces change.
   */
  private get roomDevices(): string[] {
    const hass = this.hass;
    if (!hass || this.element?.type !== "room") return [];
    const area = this.chosenArea || undefined;
    let memo = this.devicesMemo;
    if (
      memo === undefined ||
      memo.entities !== hass.entities ||
      memo.area !== area ||
      memo.pieces !== this.pieceEntities
    ) {
      const linked = this.pieceEntities.map((id) => ({ entity_id: id }));
      memo = {
        entities: hass.entities,
        area,
        pieces: this.pieceEntities,
        value: devicesFrom(hass, area, linked),
      };
      this.devicesMemo = memo;
    }
    // A scene or a script first: what a room's own action most often is.
    const first = (id: string): number => (/^(scene|script)\./.test(id) ? 0 : 1);
    return presentDevices(hass, memo.value)
      .all.filter((id) => presets(id).length > 0)
      .sort((a, b) => first(a) - first(b) || a.localeCompare(b));
  }

  private save(): void {
    const element = this.element;
    if (!element) return;
    let change: LinkChange;
    if (element.type === "room") {
      const actions = this.roomActionsToSave();
      if (actions === null) return;
      change = { room: element.id, area: this.chosenArea || null, actions };
    } else {
      const binding: ElementBinding = { entities: this.entities };
      if (this.device) binding.device = this.device;
      const ids = this.linkedIds;
      const primary = this.primary;
      const tap = draftAction(this.tap, this.binding?.tap_action, ids, primary);
      const hold = draftAction(this.hold, this.binding?.hold_action, ids, primary);
      if (tap === null || hold === null) return;
      if (tap) binding.tap_action = tap;
      if (hold) binding.hold_action = hold;
      if (this.hasCamera) {
        for (const [key, low, high] of VIEW_FIELDS) {
          const value = viewValue(this[key], low, high);
          if (value === null) return;
          if (value !== undefined) binding[key] = value;
        }
      }
      change = { element: element.id, binding };
    }
    fire(this, "domotwin-link-save", change);
  }

  /** A room's actions to store; `null` while one has no name or nothing valid to do. */
  private roomActionsToSave(): RoomAction[] | null {
    const devices = this.roomDevices;
    const out: RoomAction[] = [];
    for (const entry of this.actions) {
      const name = entry.name.trim();
      const action = draftAction(entry.draft, entry.original, devices);
      if (!name || !action) return null;
      out.push({ name, action });
    }
    return out;
  }

  /** A field of an action or of the camera's view is not valid: nothing to save yet. */
  private get invalid(): boolean {
    if (this.element?.type === "room") return this.roomActionsToSave() === null;
    const ids = this.linkedIds;
    const primary = this.primary;
    return (
      draftAction(this.tap, this.binding?.tap_action, ids, primary) === null ||
      draftAction(this.hold, this.binding?.hold_action, ids, primary) === null ||
      (this.hasCamera &&
        VIEW_FIELDS.some(([key, low, high]) => viewValue(this[key], low, high) === null))
    );
  }

  /** A camera is linked to a piece: what it sees can be set (cones start from pieces). */
  private get hasCamera(): boolean {
    return (
      this.element?.type === "furniture" &&
      this.entities.some((entity) => roleOf(entity, this.hass) === "camera")
    );
  }

  private setRole(entityId: string, role: string): void {
    this.entities = this.entities.map((entity) => {
      if (entity.entity_id !== entityId) return entity;
      const next: BoundEntity = { entity_id: entity.entity_id };
      if (role) next.role = role as Role;
      return next;
    });
  }

  private link(entityId: string): void {
    this.entities = [...this.entities, { entity_id: entityId }];
    this.query = "";
  }

  private unlink(entityId: string): void {
    this.entities = this.entities.filter((e) => e.entity_id !== entityId);
    // An action aimed at it now aims at no entity in particular; one of its plain actions is gone.
    const forget = (draft: ActionDraft, original?: Action): ActionDraft => {
      if (draft.choice === "preset" && draft.preset.startsWith(`${entityId} `)) {
        // A toggle written bare toggles the main device, whichever it is now.
        if (original?.action === "toggle" && original.entity_id === undefined) {
          this.advanced = true;
          return { ...draft, choice: "toggle", preset: "" };
        }
        return { ...draft, choice: "auto", preset: "" };
      }
      return draft.target === entityId ? { ...draft, target: "" } : draft;
    };
    this.tap = forget(this.tap, this.binding?.tap_action);
    this.hold = forget(this.hold, this.binding?.hold_action);
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const element = this.element;
    if (!hass || !element) return nothing;
    const t = this.t;
    const footer = html`<div class="footer">
      <button
        class="action quiet"
        @click=${() => {
          this.close();
        }}
      >
        ${t.t("link.cancel")}
      </button>
      <button
        class="action"
        data-testid="link-save"
        ?disabled=${this.busy || this.invalid}
        @click=${() => {
          this.save();
        }}
      >
        ${t.t("link.save")}
      </button>
    </div>`;
    return this.frame(
      element.type === "room" ? this.renderRoom(hass) : this.renderElement(hass, element),
      footer,
    );
  }

  private renderRoom(hass: HomeAssistant): TemplateResult {
    const t = this.t;
    const areas = Object.values(hass.areas ?? {})
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
    const byName = !this.area && this.roomArea ? hass.areas?.[this.roomArea]?.name : undefined;
    return html`<label>
        <h3>${t.t("link.area")}</h3>
        <select
          @change=${(event: Event) => {
            this.chosenArea = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value="" ?selected=${this.chosenArea === ""}>${t.t("link.area_none")}</option>
          ${areas.map(
            (a) =>
              html`<option value=${a.area_id} ?selected=${a.area_id === this.chosenArea}>
                ${a.name}
              </option>`,
          )}
        </select>
      </label>
      ${byName ? html`<p class="hint">${t.t("link.area_by_name", { area: byName })}</p>` : nothing}
      ${this.renderRoomActions(hass, t)}`;
  }

  /** A room's own actions: each a name and what it does, at most `MAX_ROOM_ACTIONS`. */
  private renderRoomActions(hass: HomeAssistant, t: Translator): TemplateResult {
    const devices = this.roomDevices;
    const setAt = (index: number, patch: Partial<RoomActionDraft>): void => {
      this.actions = this.actions.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    };
    const invalid = this.actions.length > 0 && this.roomActionsToSave() === null;
    return html`<h3>${t.t("link.room_actions")}</h3>
      <p class="hint">${t.t("link.room_actions_hint")}</p>
      ${this.actions.map((entry, index) => {
        const name = entry.name.trim() || t.t("link.room_action_untitled");
        return html`<div class="room-action" data-testid="room-action">
          <div class="entity">
            <input
              data-testid=${`room-action-name-${index}`}
              aria-label=${t.t("link.room_action_name")}
              placeholder=${t.t("link.room_action_name")}
              maxlength=${MAX_ACTION_NAME}
              autocomplete="off"
              .value=${entry.name}
              @input=${(event: Event) => {
                setAt(index, { name: (event.target as HTMLInputElement).value });
              }}
            />
            <button
              class="round"
              aria-label=${t.t("link.room_action_remove", { name })}
              @click=${() => {
                this.actions = this.actions.filter((_, i) => i !== index);
              }}
            >
              ${icon(mdiClose)}
            </button>
          </div>
          ${this.actionEditor(hass, {
            id: `room-action-${index}`,
            label: t.t("link.room_action_what"),
            draft: entry.draft,
            set: (patch) => {
              setAt(index, { draft: { ...entry.draft, ...patch } });
            },
            entities: devices,
            piece: false,
            original: entry.original,
            written: entry.written,
          })}
        </div>`;
      })}
      ${invalid ? html`<p class="hint error">${t.t("link.room_action_invalid")}</p>` : nothing}
      ${
        this.actions.length < MAX_ROOM_ACTIONS
          ? html`<div class="footer">
              <button
                class="action quiet"
                data-testid="room-action-add"
                @click=${() => {
                  const first = devices.flatMap((id) => presets(id))[0];
                  const draft = actionDraft(undefined);
                  this.actions = [
                    ...this.actions,
                    {
                      name: "",
                      draft: first
                        ? { ...draft, choice: "preset", preset: presetKey(first) }
                        : { ...draft, choice: "perform-action" },
                      written: false,
                    },
                  ];
                  // Nothing plain to offer: what it does is written in the advanced mode.
                  if (!first) this.advanced = true;
                }}
              >
                ${icon(mdiPlus)}${t.t("link.room_action_add")}
              </button>
            </div>`
          : nothing
      }
      ${this.advancedSwitch(t)}`;
  }

  /** The advanced mode's switch; it stays on while an action needs it. */
  private advancedSwitch(t: Translator): TemplateResult {
    const drafts = [this.tap, this.hold, ...this.actions.map((entry) => entry.draft)];
    const needed = this.advanced && drafts.some((draft) => ADVANCED_CHOICES.has(draft.choice));
    return html`<label class="advanced">
      <input
        type="checkbox"
        data-testid="link-advanced"
        .checked=${this.advanced}
        ?disabled=${needed}
        @change=${(event: Event) => {
          this.advanced = (event.target as HTMLInputElement).checked;
        }}
      />
      <span
        >${t.t("link.advanced")}
        <small class="hint"
          >${needed ? t.t("link.advanced_needed") : t.t("link.advanced_hint")}</small
        ></span
      >
    </label>`;
  }

  private renderElement(hass: HomeAssistant, element: PlanElementInfo): TemplateResult {
    const t = this.t;
    const linked = this.entities.map((e) => e.entity_id);
    const suggested = suggestions(hass, element, this.roomArea, linked);
    const found = searchEntities(hass, element, this.query, linked);
    const areaName = this.roomArea ? hass.areas?.[this.roomArea]?.name : undefined;
    const entry = this.device ? hass.devices?.[this.device] : undefined;
    const device = this.device ? entry?.name_by_user || entry?.name || this.device : undefined;
    return html`<h3>${t.t("link.linked")}</h3>
      ${
        device
          ? html`<div class="entity" data-testid="linked-device">
              <span class="text"><span>${t.t("link.device", { name: device })}</span></span>
              <button
                class="round"
                aria-label=${t.t("link.device_remove", { name: device })}
                @click=${() => {
                  this.device = "";
                }}
              >
                ${icon(mdiClose)}
              </button>
            </div>`
          : nothing
      }
      ${
        this.entities.length === 0 && !device
          ? html`<p class="hint">${t.t("link.none")}</p>`
          : this.entities.map((entity) => {
              const name = entityName(hass, entity.entity_id);
              const derived = t.t(`link.role_${deriveRole(entity.entity_id, hass)}`);
              return html`<div class="entity">
                <span class="text"
                  ><span>${name}</span><small>${entity.entity_id}</small>
                  <select
                    class="role"
                    data-testid=${`role-${entity.entity_id}`}
                    aria-label=${t.t("link.role_of", { name })}
                    @change=${(event: Event) => {
                      this.setRole(entity.entity_id, (event.target as HTMLSelectElement).value);
                    }}
                  >
                    <option value="" ?selected=${!entity.role}>
                      ${t.t("link.role_auto", { role: derived })}
                    </option>
                    ${ROLES.map(
                      (role) =>
                        html`<option value=${role} ?selected=${entity.role === role}>
                          ${t.t(`link.role_${role}`)}
                        </option>`,
                    )}
                  </select></span
                >
                <button
                  class="round"
                  aria-label=${t.t("link.remove", { name })}
                  @click=${() => {
                    this.unlink(entity.entity_id);
                  }}
                >
                  ${icon(mdiClose)}
                </button>
              </div>`;
            })
      }
      ${this.hasCamera ? this.viewEditor() : nothing}
      <h3>
        ${areaName ? t.t("link.suggestions", { area: areaName }) : t.t("link.suggestions_title")}
      </h3>
      ${
        suggested.length > 0
          ? suggested.map((id) => this.candidate(hass, id))
          : html`<p class="hint">
              ${areaName ? t.t("link.suggestions_empty") : t.t("link.suggestions_no_area")}
            </p>`
      }
      <label>
        <h3>${t.t("link.search")}</h3>
        <input
          type="search"
          autocomplete="off"
          .value=${this.query}
          placeholder=${t.t("link.search_hint")}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      ${found.map((id) => this.candidate(hass, id))} ${this.pieceAction(hass, "tap")}
      ${this.pieceAction(hass, "hold")} ${this.advancedSwitch(t)}`;
  }

  /** A piece's tap or long-press action. */
  private pieceAction(hass: HomeAssistant, which: "tap" | "hold"): TemplateResult {
    const t = this.t;
    const original = which === "tap" ? this.binding?.tap_action : this.binding?.hold_action;
    let auto: string;
    if (which === "hold") auto = t.t("link.action_controls");
    else {
      const action = tapAction({ entities: this.entities }, hass).action;
      auto = t.t(
        action === "toggle"
          ? "link.action_toggle"
          : action === "more-info"
            ? "link.action_more_info"
            : "link.action_controls",
      );
    }
    return this.actionEditor(hass, {
      id: `link-${which}`,
      label: t.t(which === "tap" ? "link.tap" : "link.hold"),
      draft: which === "tap" ? this.tap : this.hold,
      set: (patch) => {
        if (which === "tap") this.tap = { ...this.tap, ...patch };
        else this.hold = { ...this.hold, ...patch };
      },
      entities: this.linkedIds,
      auto,
      primary: this.primary,
      piece: true,
      original,
      written:
        original !== undefined &&
        actionDraft(original, this.linkedIds, this.primary).choice === "custom",
    });
  }

  /** What a linked camera sees on the plan: its angle of view and reach. */
  private viewEditor(): TemplateResult {
    const t = this.t;
    const invalid = VIEW_FIELDS.some(
      ([key, low, high]) => viewValue(this[key], low, high) === null,
    );
    return html`<h3>${t.t("link.camera_view")}</h3>
      ${VIEW_FIELDS.map(
        ([key, , , fallback]) =>
          html`<label>
            <span class="field">${t.t(`link.${key}`)}</span>
            <input
              type="text"
              inputmode="decimal"
              autocomplete="off"
              data-testid=${`link-${key}`}
              placeholder=${String(fallback)}
              .value=${this[key]}
              @input=${(event: Event) => {
                this[key] = (event.target as HTMLInputElement).value;
              }}
            />
          </label>`,
      )}
      ${invalid ? html`<p class="hint error">${t.t("link.view_invalid")}</p>` : nothing}`;
  }

  /**
   * The choice of an action and its fields: the plain actions of the devices, grouped by device,
   * then a piece's own choices; the advanced mode adds the others and their fields.
   */
  private actionEditor(hass: HomeAssistant, field: ActionField): TemplateResult {
    const t = this.t;
    const { draft, set, id } = field;
    const advanced = this.advanced;
    // What was written by hand stays on offer, even once something else is chosen.
    const custom = field.original !== undefined && (draft.choice === "custom" || field.written);
    // A plain action of a device no longer offered (another area chosen) still shows.
    const chosen = draft.choice === "preset" ? draft.preset.split(" ")[0] : undefined;
    const entities =
      chosen && !field.entities.includes(chosen) ? [...field.entities, chosen] : field.entities;
    const groups = entities
      .map((entity) => ({ entity, list: presets(entity) }))
      .filter((group) => group.list.length > 0);
    return html`<label>
        <h3>${field.label}</h3>
        <select
          data-testid=${id}
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            if (value.startsWith("preset:")) set({ choice: "preset", preset: value.slice(7) });
            else set({ choice: value as ActionChoice });
          }}
        >
          ${
            field.auto !== undefined
              ? html`<option value="auto" ?selected=${draft.choice === "auto"}>
                  ${t.t("link.action_auto", { action: field.auto })}
                </option>`
              : nothing
          }
          ${groups.map(
            (group) =>
              html`<optgroup label=${entityName(hass, group.entity)}>
                ${group.list.map((preset) => {
                  const key = presetKey(preset);
                  // Several devices: which one, as the list closed shows only the choice.
                  const label =
                    groups.length > 1
                      ? `${t.t(preset.label)} · ${entityName(hass, group.entity)}`
                      : t.t(preset.label);
                  return html`<option
                    value=${`preset:${key}`}
                    ?selected=${draft.choice === "preset" && draft.preset === key}
                  >
                    ${label}
                  </option>`;
                })}
              </optgroup>`,
          )}
          ${(field.piece ? PIECE_CHOICES : []).map(
            ([choice, label]) =>
              html`<option value=${choice} ?selected=${draft.choice === choice}>
                ${t.t(label)}
              </option>`,
          )}
          ${
            advanced
              ? ADVANCED.filter(([choice]) => field.piece || choice !== "toggle").map(
                  ([choice, label]) =>
                    html`<option value=${choice} ?selected=${draft.choice === choice}>
                      ${t.t(label)}
                    </option>`,
                )
              : nothing
          }
          ${
            custom
              ? html`<option value="custom" ?selected=${draft.choice === "custom"}>
                  ${t.t("link.action_custom")}
                </option>`
              : nothing
          }
        </select>
      </label>
      ${draft.choice === "perform-action" ? this.performFields(hass, field) : nothing}
      ${
        draft.choice === "navigate"
          ? html`<label>
                <span class="field">${t.t("link.path")}</span>
                <input
                  data-testid=${`${id}-path`}
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="/lovelace/0"
                  .value=${draft.path}
                  @input=${(event: Event) => {
                    set({ path: (event.target as HTMLInputElement).value });
                  }}
                />
              </label>
              ${
                draft.path && !validPath(draft.path)
                  ? html`<p class="hint error">${t.t("link.path_invalid")}</p>`
                  : nothing
              }`
          : nothing
      }`;
  }

  /** "Run an action": the action, the entity it acts on, its data. */
  private performFields(hass: HomeAssistant, field: ActionField): TemplateResult {
    const t = this.t;
    const { draft, set, id } = field;
    return html`<label>
        <span class="field">${t.t("link.service")}</span>
        <input
          data-testid=${`${id}-service`}
          autocomplete="off"
          spellcheck="false"
          placeholder="scene.turn_on"
          .value=${draft.service}
          @input=${(event: Event) => {
            set({ service: (event.target as HTMLInputElement).value });
          }}
        />
      </label>
      ${
        draft.service && !validService(draft.service)
          ? html`<p class="hint error">${t.t("link.service_invalid")}</p>`
          : nothing
      }
      <label>
        <span class="field">${t.t("link.target")}</span>
        <select
          data-testid=${`${id}-target`}
          @change=${(event: Event) => {
            set({ target: (event.target as HTMLSelectElement).value });
          }}
        >
          <option value="" ?selected=${draft.target === ""}>${t.t("link.target_none")}</option>
          ${
            // A target written in the file that is not offered: shown, so it can be changed.
            draft.target && !field.entities.includes(draft.target)
              ? html`<option value=${draft.target} selected>
                  ${entityName(hass, draft.target)}
                </option>`
              : nothing
          }
          ${field.entities.map(
            (entity) =>
              html`<option value=${entity} ?selected=${draft.target === entity}>
                ${entityName(hass, entity)}
              </option>`,
          )}
        </select>
      </label>
      <label>
        <span class="field">${t.t("link.data")}</span>
        <textarea
          data-testid=${`${id}-data`}
          spellcheck="false"
          placeholder='{"brightness_pct": 50}'
          .value=${draft.data}
          @input=${(event: Event) => {
            set({ data: (event.target as HTMLTextAreaElement).value });
          }}
        ></textarea>
      </label>
      ${
        parseData(draft.data) === null
          ? html`<p class="hint error">${t.t("link.data_invalid")}</p>`
          : nothing
      }`;
  }

  private candidate(hass: HomeAssistant, id: string): TemplateResult {
    const name = entityName(hass, id);
    return html`<div class="entity">
      <span class="text"><span>${name}</span><small>${id}</small></span>
      <button
        class="round"
        aria-label=${this.t.t("link.add", { name })}
        @click=${() => {
          this.link(id);
        }}
      >
        ${icon(mdiPlus)}
      </button>
    </div>`;
  }
}

define("domotwin-link", DomoTwinLink);
