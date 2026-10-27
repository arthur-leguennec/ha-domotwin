/**
 * The sandbox's bar (D-057): that this is a copy and touches no device, the moment of the day
 * shown, the day playing or held and how fast, the day's runs and conflicts on a line to go
 * through, the day to play (its date, weather, who goes out and comes back), and the report.
 */
import {
  mdiAlertOutline,
  mdiArrowLeft,
  mdiCalendarEdit,
  mdiClose,
  mdiPause,
  mdiPlay,
  mdiStarFourPointsOutline,
  mdiTestTube,
  mdiTextBoxSearchOutline,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { define, fire } from "../components/define";
import { icon } from "../components/icon";
import { baseStyles } from "../components/styles";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { sandboxEn, sandboxFr } from "../i18n/sandbox";
import type { DayPlayed, FiredBy, HandCall } from "./engine";
import { SPEEDS, type SandboxHome, type Speed } from "./home";
import type { DayReport, OwnerReport, RunReport } from "./report";
import { WEATHERS, minuteText, type PersonDay, type Scenario, type Weather } from "./scenario";
import { clockOf, clockOn, parseClock, parseDate } from "./time";

addMessages({ en: sandboxEn, fr: sandboxFr });

/** At most this many runs of one automation listed: the rest are counted. */
const RUNS_LISTED = 12;

interface Mark {
  at: number;
  kind: "run" | "conflict";
}

export class DomoTwinSandboxBar extends LitElement {
  static override properties = {
    home: { attribute: false },
    held: { type: Boolean },
    open: { state: true },
    draft: { state: true },
    draftError: { state: true },
  };

  /** The sandbox shown. */
  home?: SandboxHome;
  /** Its time held while something runs on it (an import, the plan editor). */
  held = false;
  /** The day's form or the report, open under the bar. */
  protected open?: "day" | "report";
  /** The day being written in the form. */
  protected draft?: Scenario;
  protected draftError?: string;
  /** What was done by hand that the form forgets on Play this day (each call's key). */
  private forgotten = new Set<string>();
  private unwatch?: () => void;
  private marked?: { day: DayPlayed; marks: Mark[] };
  private dragging = false;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        font-size: 0.85rem;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        padding: 6px 12px;
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 12%,
          var(--card-background-color, #fff)
        );
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .what {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
      }
      .note {
        color: var(--secondary-text-color, #5f6368);
        flex: 1 1 14em;
      }
      .time {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      time {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        min-width: 3.2em;
        text-align: center;
      }
      button,
      select,
      input {
        min-height: 32px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.16));
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        cursor: pointer;
      }
      select,
      input {
        padding: 2px 8px;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      button.round {
        width: 32px;
        padding: 0;
        justify-content: center;
      }
      button[aria-expanded="true"] {
        background: color-mix(
          in srgb,
          var(--domotwin-accent, var(--primary-color, #03a9f4)) 18%,
          var(--card-background-color, #fff)
        );
      }
      button:focus-visible,
      select:focus-visible,
      input:focus-visible,
      .line:focus-visible {
        outline: 2px solid var(--domotwin-accent, var(--primary-color, #03a9f4));
        outline-offset: 2px;
      }
      .count {
        min-width: 1.4em;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--error-color, #db4437);
        color: #fff;
        font-size: 0.75rem;
        text-align: center;
      }
      .line {
        position: relative;
        height: 28px;
        margin: 0 12px 6px;
        border-radius: 6px;
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
        cursor: pointer;
        touch-action: none;
      }
      .hour {
        position: absolute;
        bottom: 1px;
        font-size: 0.65rem;
        color: var(--secondary-text-color, #5f6368);
        transform: translateX(-50%);
        pointer-events: none;
      }
      .mark {
        position: absolute;
        top: 4px;
        width: 2px;
        height: 12px;
        background: var(--domotwin-accent, var(--primary-color, #03a9f4));
        opacity: 0.75;
        pointer-events: none;
      }
      /* Hydro-Québec's announced peak (D-063), as the peak's layer colours it. */
      .band {
        position: absolute;
        top: 0;
        bottom: 0;
        opacity: 0.22;
        pointer-events: none;
      }
      .band.preheat {
        background: #f29e2e;
      }
      .band.peak {
        background: #d7191c;
      }
      .mark.conflict {
        width: 4px;
        height: 18px;
        top: 2px;
        background: var(--error-color, #db4437);
        opacity: 1;
      }
      .cursor {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--primary-text-color, #1f2328);
        pointer-events: none;
      }
      /* The automation written in plain words, played beside the home's (D-066). */
      .draft {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
        padding: 4px 12px;
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        background: var(--card-background-color, #fff);
      }
      .draft .what {
        overflow-wrap: anywhere;
      }
      .sheet {
        max-height: min(55vh, 520px);
        overflow-y: auto;
        padding: 8px 12px 12px;
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        background: var(--card-background-color, #fff);
      }
      h2 {
        margin: 4px 0 8px;
        font-size: 1rem;
      }
      h3 {
        margin: 12px 0 4px;
        font-size: 0.9rem;
      }
      .fields {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        align-items: end;
      }
      label {
        display: inline-flex;
        flex-direction: column;
        gap: 2px;
      }
      label.check {
        flex-direction: row;
        align-items: center;
        gap: 6px;
      }
      .person {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 6px 14px;
        padding: 4px 0;
      }
      .person .name {
        min-width: 8em;
        font-weight: 600;
      }
      ul {
        margin: 0;
        padding-inline-start: 18px;
      }
      li {
        margin: 2px 0;
      }
      .muted {
        color: var(--secondary-text-color, #5f6368);
      }
      .error {
        color: var(--error-color, #db4437);
      }
      .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 10px;
      }
      button.link {
        min-height: 0;
        padding: 0 4px;
        border: none;
        background: none;
        color: var(--domotwin-accent, var(--primary-color, #03a9f4));
        font-variant-numeric: tabular-nums;
        text-decoration: underline;
      }
      svg.icon {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }
    `,
  ];

  protected override updated(changed: PropertyValues): void {
    if (changed.has("home")) this.follow();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.home && !this.unwatch) this.follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unwatch?.();
    this.unwatch = undefined;
  }

  private follow(): void {
    this.unwatch?.();
    this.unwatch = this.home?.watchClock(() => {
      this.requestUpdate();
    });
  }

  private get t(): Translator {
    return translatorFor(this.home?.hass);
  }

  /** The day's runs and conflicts, read once for each day played. */
  private marks(home: SandboxHome): Mark[] {
    if (this.marked?.day !== home.day) {
      const marks: Mark[] = [];
      for (const entry of home.day.log) {
        if (entry.kind === "fired" && entry.outcome === "ran")
          marks.push({ at: entry.at, kind: "run" });
      }
      for (const conflict of home.dayReport().conflicts)
        marks.push({ at: conflict.at, kind: "conflict" });
      this.marked = { day: home.day, marks };
    }
    return this.marked.marks;
  }

  private seekAt(event: PointerEvent): void {
    const home = this.home;
    const line = event.currentTarget as HTMLElement | null;
    if (!home || !line) return;
    const box = line.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
    home.seek(home.day.start + share * (home.day.end - home.day.start));
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const home = this.home;
    if (!home || this.held) return;
    const steps: Record<string, number> = {
      ArrowLeft: -5 * 60_000,
      ArrowRight: 5 * 60_000,
      PageDown: -3_600_000,
      PageUp: 3_600_000,
    };
    if (event.key === "Home") home.seek(home.day.start);
    else if (event.key === "End") home.seek(home.day.end);
    else if (event.key in steps) home.seek(home.cursor + (steps[event.key] ?? 0));
    else return;
    event.preventDefault();
  };

  /** The announced peak's pre-heating and peak on the day's line, when it is its day (D-063). */
  private peakBands(home: SandboxHome): { kind: "preheat" | "peak"; from: number; to: number }[] {
    const peak = home.peakToday();
    if (!peak) return [];
    const within = (at: number) => Math.min(Math.max(at, home.day.start), home.day.end);
    return [
      { kind: "preheat" as const, from: within(peak.preheat), to: within(peak.start) },
      { kind: "peak" as const, from: within(peak.start), to: within(peak.end) },
    ].filter((band) => band.to > band.from);
  }

  private renderLine(home: SandboxHome, t: Translator): TemplateResult {
    const span = Math.max(1, home.day.end - home.day.start);
    const place = (at: number) => `${(((at - home.day.start) / span) * 100).toFixed(3)}%`;
    const now = clockOf(home.cursor, home.zone);
    return html`<div
      class="line"
      role="slider"
      tabindex="0"
      data-testid="sandbox-line"
      aria-label=${t.t("sandbox.timeline")}
      aria-valuemin="0"
      aria-valuemax=${Math.round(span / 60_000)}
      aria-valuenow=${Math.round((home.cursor - home.day.start) / 60_000)}
      aria-valuetext=${now}
      aria-disabled=${this.held ? "true" : "false"}
      @keydown=${this.onKey}
      @pointerdown=${(event: PointerEvent) => {
        if (this.held) return;
        this.dragging = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.seekAt(event);
      }}
      @pointermove=${(event: PointerEvent) => {
        if (this.dragging) this.seekAt(event);
      }}
      @pointerup=${() => {
        this.dragging = false;
      }}
      @pointercancel=${() => {
        this.dragging = false;
      }}
    >
      ${[0, 6, 12, 18].map(
        (hour) =>
          html`<span
            class="hour"
            style=${`left:${place(clockOn(home.day.start, home.zone, hour * 60))}`}
            >${hour}h</span
          >`,
      )}
      ${this.peakBands(home).map(
        (band) =>
          html`<span
            class="band ${band.kind}"
            data-testid="sandbox-peak-band"
            style=${`left:${place(band.from)};width:${(((band.to - band.from) / span) * 100).toFixed(3)}%`}
          ></span>`,
      )}
      ${this.marks(home).map(
        (mark) => html`<span class="mark ${mark.kind}" style=${`left:${place(mark.at)}`}></span>`,
      )}
      <span class="cursor" style=${`left:${place(home.cursor)}`}></span>
    </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const home = this.home;
    if (!home) return nothing;
    const t = this.t;
    const playing = home.playing;
    const report = home.dayReport();
    const problems =
      report.conflicts.length +
      report.owners.filter((o) => o.notPlayed.length > 0 || o.looping).length;
    return html`<div
        class="bar"
        role="region"
        aria-label=${t.t("sandbox.title")}
        data-testid="sandbox-bar"
      >
        <span class="what">${icon(mdiTestTube)}${t.t("sandbox.title")}</span>
        <span class="note">${t.t("sandbox.note")}</span>
        <span class="time">
          <time aria-label=${t.t("sandbox.time")} data-testid="sandbox-time" datetime=${home.time()}
            >${clockOf(home.cursor, home.zone)}</time
          >
          <span class="muted">${home.scenario.date}</span>
          <button
            class="round"
            data-testid="sandbox-play"
            ?disabled=${this.held}
            aria-pressed=${playing ? "true" : "false"}
            aria-label=${t.t(playing ? "sandbox.pause" : "sandbox.play")}
            title=${t.t(playing ? "sandbox.pause" : "sandbox.play")}
            @click=${() => {
              home.play(!playing);
            }}
          >
            ${icon(playing ? mdiPause : mdiPlay)}
          </button>
          <select
            data-testid="sandbox-speed"
            aria-label=${t.t("sandbox.speed")}
            @change=${(event: Event) => {
              const value = Number((event.target as HTMLSelectElement).value);
              const speed = SPEEDS.find((s) => s === value);
              if (speed) home.setSpeed(speed);
            }}
          >
            ${SPEEDS.map(
              (speed: Speed) =>
                html`<option value=${speed} ?selected=${speed === home.speed}>
                  ${t.t(`sandbox.speed_${speed}`)}
                </option>`,
            )}
          </select>
        </span>
        <button
          data-testid="sandbox-day"
          aria-expanded=${this.open === "day" ? "true" : "false"}
          ?disabled=${this.held}
          @click=${() => {
            this.toggle("day");
          }}
        >
          ${icon(mdiCalendarEdit)}${t.t("sandbox.day_button")}
        </button>
        <button
          data-testid="sandbox-report"
          aria-expanded=${this.open === "report" ? "true" : "false"}
          @click=${() => {
            this.toggle("report");
          }}
        >
          ${icon(mdiTextBoxSearchOutline)}${t.t("sandbox.report_button")}
          ${problems > 0 ? html`<span class="count" data-testid="sandbox-problems">${problems}</span>` : nothing}
        </button>
        <button
          data-testid="sandbox-leave"
          ?disabled=${this.held}
          @click=${() => {
            fire(this, "domotwin-sandbox-leave", {});
          }}
        >
          ${icon(mdiClose)}${t.t("sandbox.leave")}
        </button>
      </div>
      ${this.renderDraft(home, t)} ${this.renderLine(home, t)}
      ${this.open === "day" ? this.renderDay(home, t) : nothing}
      ${this.open === "report" ? this.renderReport(home, report, t) : nothing}`;
  }

  /** What the draft did on the day shown, in a sentence or two. */
  private draftSummary(home: SandboxHome, t: Translator): string {
    const day = home.draftDay();
    if (!day) return "";
    const said = [
      day.runs.length > 0
        ? t.tp("sandbox.draft.ran", day.runs.length)
        : day.stopped > 0
          ? t.tp("sandbox.report.stopped_by_conditions", day.stopped)
          : day.busy > 0
            ? t.tp("sandbox.report.busy", day.busy)
            : t.t("sandbox.report.never_set_off"),
    ];
    if (day.against.length > 0) {
      said.push(
        t.t("sandbox.report.draft_against", {
          names: day.against.map((id) => home.name(id)).join(", "),
        }),
      );
    } else if (day.backAndForth) said.push(t.t("sandbox.report.draft_flap"));
    if (day.looping) said.push(t.t("sandbox.report.looping"));
    return said.join(" ");
  }

  /** The automation written in plain words, played beside the home's (D-066), and the way back. */
  private renderDraft(home: SandboxHome, t: Translator): TemplateResult | typeof nothing {
    const draft = home.draft;
    if (!draft) return nothing;
    return html`<div
      class="draft"
      role="group"
      aria-label=${t.t("sandbox.draft.title", { name: draft.name })}
      data-testid="sandbox-draft"
    >
      <span class="what"
        >${icon(mdiStarFourPointsOutline)}${t.t("sandbox.draft.title", { name: draft.name })}</span
      >
      <span class="note">${t.t("sandbox.draft.note")}</span>
      <span role="status" data-testid="sandbox-draft-day">${this.draftSummary(home, t)}</span>
      <button
        data-testid="sandbox-draft-back"
        ?disabled=${this.held}
        @click=${() => {
          fire(this, "domotwin-sandbox-draft", {});
        }}
      >
        ${icon(mdiArrowLeft)}${t.t("sandbox.draft.back")}
      </button>
    </div>`;
  }

  private toggle(what: "day" | "report"): void {
    this.open = this.open === what ? undefined : what;
    if (this.open === "day" && this.home) {
      this.draft = structuredClone(this.home.scenario);
      this.draftError = undefined;
      this.forgotten = new Set();
    }
  }

  // ------------------------------------------------------------------------------- the day

  private setPerson(
    index: number,
    change: Partial<PersonDay> & { clear?: "leaves" | "back" },
  ): void {
    const draft = this.draft;
    if (!draft) return;
    const people = draft.people.map((person, k) => {
      if (k !== index) return person;
      const { clear, ...given } = change;
      const next: PersonDay = { ...person, ...given };
      if (clear === "leaves") delete next.leaves;
      if (clear === "back") delete next.back;
      return next;
    });
    this.draft = { ...draft, people };
  }

  private renderDay(home: SandboxHome, t: Translator): TemplateResult {
    const draft = this.draft ?? home.scenario;
    const calls = home.scenario.calls.filter((call) => !this.forgotten.has(callKey(call)));
    const minuteOf = (value: string): number | undefined => {
      const seconds = parseClock(value);
      return seconds === undefined ? undefined : Math.floor(seconds / 60);
    };
    return html`<section class="sheet" data-testid="sandbox-day-sheet" aria-labelledby="day-title">
      <h2 id="day-title">${t.t("sandbox.scenario.title")}</h2>
      <div class="fields">
        <label>
          ${t.t("sandbox.scenario.date")}
          <input
            type="date"
            data-testid="sandbox-date"
            .value=${draft.date}
            @change=${(event: Event) => {
              this.draft = { ...draft, date: (event.target as HTMLInputElement).value };
            }}
          />
        </label>
        <label>
          ${t.t("sandbox.scenario.weather")}
          <select
            data-testid="sandbox-weather"
            @change=${(event: Event) => {
              const value = (event.target as HTMLSelectElement).value;
              const weather = WEATHERS.find((w) => w === value);
              if (weather) this.draft = { ...draft, weather };
            }}
          >
            ${WEATHERS.map(
              (weather: Weather) =>
                html`<option value=${weather} ?selected=${weather === draft.weather}>
                  ${t.t(`sandbox.scenario.${weather}`)}
                </option>`,
            )}
          </select>
        </label>
        ${(["low", "high"] as const).map(
          (key) =>
            html`<label>
              ${t.t(`sandbox.scenario.${key}`)}
              <input
                type="number"
                step="1"
                data-testid=${`sandbox-${key}`}
                .value=${String(draft[key])}
                @change=${(event: Event) => {
                  const value = Number((event.target as HTMLInputElement).value);
                  if (Number.isFinite(value)) this.draft = { ...draft, [key]: value };
                }}
              />
            </label>`,
        )}
      </div>
      ${this.renderPeak(home, draft, t)}
      <h3>${t.t("sandbox.scenario.people")}</h3>
      ${
        draft.people.length === 0
          ? html`<p class="muted">${t.t("sandbox.scenario.no_people")}</p>`
          : draft.people.map(
              (person, index) =>
                html`<div class="person" data-person=${person.id}>
                  <span class="name">${home.name(person.id)}</span>
                  <label class="check">
                    <input
                      type="checkbox"
                      data-testid="sandbox-person-home"
                      .checked=${person.home}
                      @change=${(event: Event) => {
                        this.setPerson(index, { home: (event.target as HTMLInputElement).checked });
                      }}
                    />
                    ${t.t("sandbox.scenario.home")}
                  </label>
                  ${(["leaves", "back"] as const).map(
                    (key) =>
                      html`<label>
                        ${t.t(`sandbox.scenario.${key}`)}
                        <input
                          type="time"
                          data-testid=${`sandbox-person-${key}`}
                          .value=${person[key] === undefined ? "" : minuteText(person[key])}
                          @change=${(event: Event) => {
                            const value = (event.target as HTMLInputElement).value;
                            const minute = minuteOf(value);
                            this.setPerson(
                              index,
                              minute === undefined ? { clear: key } : { [key]: minute },
                            );
                          }}
                        />
                      </label>`,
                  )}
                </div>`,
            )
      }
      <h3>${t.t("sandbox.scenario.by_hand")}</h3>
      ${
        // What is done by hand while the form is open shows here too, and is kept.
        calls.length === 0
          ? html`<p class="muted">${t.t("sandbox.scenario.by_hand_none")}</p>`
          : html`<ul data-testid="sandbox-calls">
              ${calls.map((call) => {
                const what = `${clockOf(call.at, home.zone)} ${call.domain}.${call.service} ${callTargets(
                  call.target,
                  call.data,
                )
                  .map((id) => home.name(id))
                  .join(", ")}`;
                return html`<li>
                  ${what}
                  <button
                    class="link"
                    data-testid="sandbox-forget"
                    @click=${() => {
                      this.forgotten.add(callKey(call));
                      this.requestUpdate();
                    }}
                  >
                    ${t.t("sandbox.scenario.forget", { what })}
                  </button>
                </li>`;
              })}
            </ul>`
      }
      ${this.draftError ? html`<p class="error" role="alert">${this.draftError}</p>` : nothing}
      <div class="actions">
        <button
          data-testid="sandbox-day-cancel"
          @click=${() => {
            this.open = undefined;
          }}
        >
          ${t.t("sandbox.scenario.cancel")}
        </button>
        <button
          data-testid="sandbox-day-apply"
          @click=${() => {
            if (!parseDate(draft.date)) {
              this.draftError = t.t("sandbox.scenario.bad_date");
              return;
            }
            // Moved to the announced peak's day: shown from its pre-heating (D-063).
            const toPeak = draft.date === home.peakDate() && draft.date !== home.scenario.date;
            home.setScenario({ ...draft, calls });
            if (toPeak) home.playPeak();
            this.open = undefined;
          }}
        >
          ${icon(mdiPlay)}${t.t("sandbox.scenario.apply")}
        </button>
      </div>
    </section>`;
  }

  /**
   * Hydro-Québec's announced peak (D-063): played when the day is its day, else a way to it.
   */
  private renderPeak(
    home: SandboxHome,
    draft: Scenario,
    t: Translator,
  ): TemplateResult | typeof nothing {
    const peak = home.announced;
    const date = home.peakDate();
    if (!peak || !date) return nothing;
    const start = clockOf(peak.start, home.zone);
    const end = clockOf(peak.end, home.zone);
    return html`<h3>${t.t("sandbox.scenario.peak")}</h3>
      ${
        draft.date === date
          ? html`<p data-testid="sandbox-peak">
                ${t.t("sandbox.scenario.peak_played", {
                  start,
                  end,
                  preheat: home.peakPreheatText((at) => clockOf(at, home.zone)),
                })}
              </p>
              ${
                // Another peak announced that day: said by the integrations, its times unknown.
                home.peakAnother && home.scenario.date === date
                  ? html`<p class="muted" data-testid="sandbox-peak-another">
                      ${t.t("sandbox.scenario.peak_another")}
                    </p>`
                  : nothing
              }`
          : html`<p class="muted" data-testid="sandbox-peak">
                ${t.t("sandbox.scenario.peak_other", { date, start, end })}
              </p>
              <button
                data-testid="sandbox-peak-day"
                @click=${() => {
                  this.draft = { ...draft, date };
                }}
              >
                ${t.t("sandbox.scenario.peak_play")}
              </button>`
      }`;
  }

  // ---------------------------------------------------------------------------- the report

  private goTo(home: SandboxHome, at: number, t: Translator): TemplateResult {
    const time = clockOf(at, home.zone);
    return html`<button
      class="link"
      aria-label=${t.t("sandbox.report.go", { time })}
      @click=${() => {
        home.play(false);
        home.seek(at);
      }}
    >
      ${time}
    </button>`;
  }

  private byText(home: SandboxHome, by: FiredBy, t: Translator): string {
    const entity = by.entity ? home.name(by.entity) : "";
    switch (by.kind) {
      case "called":
        return t.t("sandbox.report.by.called", { name: by.by ? home.name(by.by) : "" });
      case "state":
      case "numeric_state":
      case "zone":
        return t.t(`sandbox.report.by.${by.kind}`, { entity });
      case "time":
      case "time_pattern":
      case "sun":
      case "template":
      case "event":
      case "device":
        return t.t(`sandbox.report.by.${by.kind}`);
      default:
        return t.t("sandbox.report.by.other");
    }
  }

  private renderRun(home: SandboxHome, run: RunReport, t: Translator): TemplateResult {
    return html`<li data-run=${run.run}>
      ${this.goTo(home, run.at, t)} ${this.byText(home, run.by, t)}
      ${
        run.calls.length + run.said.length > 0 || run.end
          ? html`<ul>
              ${run.calls.map(
                (call) =>
                  html`<li>
                    ${
                      call.changed.length > 0
                        ? t.t("sandbox.report.changed", {
                            service: call.service,
                            entities: call.changed.map((id) => home.name(id)).join(", "),
                          })
                        : t.t("sandbox.report.unchanged", { service: call.service })
                    }
                  </li>`,
              )}
              ${run.said.map(
                (said) =>
                  html`<li>
                    ${
                      said.message
                        ? t.t("sandbox.report.said", {
                            service: said.service,
                            message: said.message,
                          })
                        : t.t("sandbox.report.said_nothing", { service: said.service })
                    }
                  </li>`,
              )}
              ${
                run.end && run.end.why !== "done"
                  ? html`<li class=${run.end.why === "error" ? "error" : "muted"}>
                      ${t.t(`sandbox.report.end.${run.end.why}`)}
                    </li>`
                  : nothing
              }
            </ul>`
          : nothing
      }
    </li>`;
  }

  private why(note: { reason: string; detail: string }, t: Translator): string {
    const known = [
      "config",
      "template",
      "effect",
      "trigger",
      "condition",
      "step",
      "time",
      "too_often",
      "repeat",
      "scene",
      "script",
    ];
    const reason = known.includes(note.reason) ? note.reason : "error";
    return t.t(`sandbox.why.${reason as "error"}`, { detail: note.detail });
  }

  /** What each room did through the announced peak, when the day is its day (D-063). */
  private renderPeakReport(home: SandboxHome, t: Translator): TemplateResult | typeof nothing {
    const rooms = home.peakReport();
    if (!rooms) return nothing;
    return html`<h3>${t.t("sandbox.report.peak")}</h3>
      ${
        rooms.length === 0
          ? html`<p class="muted" data-testid="sandbox-peak-rooms">
              ${t.t("sandbox.report.peak_none")}
            </p>`
          : html`<ul data-testid="sandbox-peak-rooms">
              ${rooms.map(
                (room) =>
                  html`<li data-room=${room.room}>
                    ${t.t("sandbox.report.peak_room", {
                      room: room.name,
                      spans: room.spans
                        .map((span) =>
                          t.t(`sandbox.report.peak_${span.role}`, {
                            from: clockOf(span.from, home.zone),
                            to: clockOf(span.to, home.zone),
                          }),
                        )
                        .join(", "),
                    })}
                  </li>`,
              )}
            </ul>`
      }`;
  }

  /** The draft first (D-066): its runs, or why it never ran; what it worked against; what could
   * not be played of it. */
  private renderDraftReport(
    home: SandboxHome,
    report: DayReport,
    t: Translator,
  ): TemplateResult | typeof nothing {
    const draft = home.draft;
    const owner = draft ? report.owners.find((each) => each.id === draft.entity) : undefined;
    if (!draft || !owner) return nothing;
    const conflicts = report.conflicts.filter(
      (conflict) => conflict.first.owner === draft.entity || conflict.second.owner === draft.entity,
    );
    return html`<h3>${t.t("sandbox.report.draft")} · ${draft.name}</h3>
      <ul data-testid="sandbox-draft-report">
        ${
          owner.runs.length > 0
            ? html`<li>
                ${t.tp("sandbox.report.runs", owner.runs.length)}
                <ul>
                  ${owner.runs.slice(0, RUNS_LISTED).map((run) => this.renderRun(home, run, t))}
                  ${owner.runs.length > RUNS_LISTED ? html`<li class="muted">…</li>` : nothing}
                </ul>
              </li>`
            : html`<li>
                ${
                  owner.stoppedByConditions > 0
                    ? t.tp("sandbox.report.stopped_by_conditions", owner.stoppedByConditions)
                    : owner.busy > 0
                      ? t.tp("sandbox.report.busy", owner.busy)
                      : t.t("sandbox.report.never_set_off")
                }
              </li>`
        }
        ${owner.looping ? html`<li class="error">${t.t("sandbox.report.looping")}</li>` : nothing}
        ${conflicts.map(
          (conflict) =>
            html`<li class="error">
              ${this.goTo(home, conflict.at, t)}
              ${t.t("sandbox.report.conflict", {
                entity: home.name(conflict.entity),
                first: home.name(conflict.first.owner),
                first_state: conflict.first.state,
                first_time: clockOf(conflict.first.at, home.zone),
                second: home.name(conflict.second.owner),
                second_state: conflict.second.state,
                second_time: clockOf(conflict.second.at, home.zone),
              })}
            </li>`,
        )}
        ${owner.notPlayed.map((note) => html`<li class="muted">${this.why(note, t)}</li>`)}
      </ul>`;
  }

  private renderReport(home: SandboxHome, report: DayReport, t: Translator): TemplateResult {
    const byName = (a: OwnerReport, b: OwnerReport) =>
      home.name(a.id).localeCompare(home.name(b.id));
    const ran = report.owners.filter((o) => o.runs.length > 0).sort(byName);
    const never = report.owners.filter((o) => report.neverRan.includes(o.id)).sort(byName);
    const notPlayed = report.owners.filter((o) => o.notPlayed.length > 0).sort(byName);
    return html`<section
      class="sheet"
      data-testid="sandbox-report-sheet"
      aria-labelledby="report-title"
    >
      <h2 id="report-title">${t.t("sandbox.report.title")}</h2>
      ${
        report.cutShort !== undefined
          ? html`<p class="error" role="alert">
              ${icon(mdiAlertOutline)}
              ${t.t("sandbox.report.cut", { time: clockOf(report.cutShort, home.zone) })}
            </p>`
          : nothing
      }
      ${this.renderDraftReport(home, report, t)}
      <h3>${t.t("sandbox.report.against")}</h3>
      ${
        report.conflicts.length === 0
          ? html`<p class="muted">${t.t("sandbox.report.none_against")}</p>`
          : html`<ul data-testid="sandbox-conflicts">
              ${report.conflicts.map(
                (conflict) =>
                  html`<li>
                    ${this.goTo(home, conflict.at, t)}
                    ${t.t("sandbox.report.conflict", {
                      entity: home.name(conflict.entity),
                      first: home.name(conflict.first.owner),
                      first_state: conflict.first.state,
                      first_time: clockOf(conflict.first.at, home.zone),
                      second: home.name(conflict.second.owner),
                      second_state: conflict.second.state,
                      second_time: clockOf(conflict.second.at, home.zone),
                    })}
                  </li>`,
              )}
            </ul>`
      }
      ${
        report.flapping.length > 0
          ? html`<h3>${t.t("sandbox.report.flapping")}</h3>
              <ul data-testid="sandbox-flapping">
                ${report.flapping.map(
                  (flap) =>
                    html`<li>
                      ${this.goTo(home, flap.at, t)}
                      ${t.t("sandbox.report.flap", {
                        entity: home.name(flap.entity),
                        count: flap.changes,
                        names: flap.owners.map((o) => home.name(o)).join(", "),
                      })}
                    </li>`,
                )}
              </ul>`
          : nothing
      }
      ${this.renderPeakReport(home, t)}
      <h3>${t.t("sandbox.report.ran")}</h3>
      ${
        ran.length === 0
          ? html`<p class="muted">${t.t("sandbox.report.none_ran")}</p>`
          : html`<ul data-testid="sandbox-ran">
              ${ran.map(
                (owner) =>
                  html`<li data-owner=${owner.id}>
                    <strong>${home.name(owner.id)}</strong> ·
                    ${t.tp("sandbox.report.runs", owner.runs.length)}
                    ${owner.looping ? html`<span class="error"> · ${t.t("sandbox.report.looping")}</span>` : nothing}
                    <ul>
                      ${owner.runs.slice(0, RUNS_LISTED).map((run) => this.renderRun(home, run, t))}
                      ${owner.runs.length > RUNS_LISTED ? html`<li class="muted">…</li>` : nothing}
                    </ul>
                  </li>`,
              )}
            </ul>`
      }
      <h3>${t.t("sandbox.report.never")}</h3>
      ${
        never.length === 0
          ? html`<p class="muted">${t.t("sandbox.report.none_never")}</p>`
          : html`<ul data-testid="sandbox-never">
              ${never.map(
                (owner) =>
                  html`<li data-owner=${owner.id}>
                    <strong>${home.name(owner.id)}</strong>:
                    ${
                      owner.stoppedByConditions > 0
                        ? t.tp("sandbox.report.stopped_by_conditions", owner.stoppedByConditions)
                        : owner.busy > 0
                          ? t.tp("sandbox.report.busy", owner.busy)
                          : t.t("sandbox.report.never_set_off")
                    }
                  </li>`,
              )}
            </ul>`
      }
      <h3>${t.t("sandbox.report.not_played")}</h3>
      ${
        notPlayed.length === 0
          ? html`<p class="muted">${t.t("sandbox.report.none_not_played")}</p>`
          : html`<ul data-testid="sandbox-not-played">
              ${notPlayed.map(
                (owner) =>
                  html`<li data-owner=${owner.id}>
                    <strong
                      >${
                        owner.id === "you"
                          ? t.t("sandbox.scenario.by_hand")
                          : owner.id === "day"
                            ? t.t("sandbox.day_button")
                            : home.name(owner.id)
                      }</strong
                    >
                    <ul>
                      ${owner.notPlayed.map((note) => html`<li>${this.why(note, t)}</li>`)}
                    </ul>
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }
}

/** A call by hand told from the others. */
function callKey(call: HandCall): string {
  return JSON.stringify([call.at, call.domain, call.service, call.data ?? {}, call.target ?? {}]);
}

/** The entities a call by hand names. */
function callTargets(
  target: Record<string, unknown> | undefined,
  data: Record<string, unknown> | undefined,
): string[] {
  const list = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");
  return [...list(target?.entity_id), ...list(data?.entity_id)];
}

define("domotwin-sandbox-bar", DomoTwinSandboxBar);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-sandbox-bar": DomoTwinSandboxBar;
  }
}

export { SandboxHome, type DraftDay, type SandboxDraft } from "./home";
export { copyHome } from "./copy";
