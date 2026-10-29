/**
 * `<domotwin-report>`: the weekly report (D-081), in the panel. The week shown and those kept
 * before; the summary, when an AI task wrote one; what needs a look, room by room on the plans
 * and section by section, each item opening where Home Assistant shows it; the week's energy
 * against the week before; the week's Hydro-Québec peaks; what was done since the last report;
 * the settings. For administrators. Loaded, with its texts, when first opened.
 */
import { mdiClose, mdiCogOutline, mdiCubeOutline, mdiOpenInNew } from "@mdi/js";
import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";

import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { reportEn, reportFr } from "../i18n/report";
import { navigate } from "../live/actions";
import { aiTasks } from "../live/ai-task";
import {
  REPORT_SECTIONS,
  changeOf,
  countOf,
  dayText,
  formatKwh,
  formatPercent,
  getReport,
  hasMaintenancePage,
  hourText,
  itemDetail,
  itemLink,
  itemsByRoom,
  planStoreys,
  saveReportSettings,
  shortDay,
  tintOf,
  totalOf,
  weekDays,
  writeReport,
  type EnergyPair,
  type ItemLink,
  type Moments,
  type PlanStorey,
  type Report,
  type ReportAnswer,
  type ReportItem,
  type ReportSection,
  type ReportSettings,
} from "../live/report";
import { timeStyle } from "../live/schedules";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: reportEn, fr: reportFr });

/** A storey's plan, as the panel holds it, and its name. */
export interface ReportPlan {
  storey: string;
  name: string;
  plan: unknown;
}

export class DomoTwinReport extends LitElement {
  static override properties = {
    hass: { attribute: false },
    plans: { attribute: false },
    closed: { attribute: false },
    asked: { attribute: false },
    answer: { state: true },
    room: { state: true },
    settingsOpen: { state: true },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
    status: { state: true },
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 4;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .dialog {
        pointer-events: auto;
        width: min(760px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        overflow: auto;
        box-sizing: border-box;
        padding: 16px;
        display: grid;
        gap: 14px;
        align-content: start;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      h2 {
        flex: 1;
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
      }
      h3 {
        margin: 0 0 6px;
        font-size: 0.95rem;
        font-weight: 600;
      }
      p {
        margin: 0;
      }
      .hint,
      .meta {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .error {
        color: var(--error-color, #d23a2f);
      }
      button.round {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        flex: none;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      button.round[aria-pressed="true"] {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 16%, transparent);
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
      }
      select,
      input[type="number"] {
        min-height: 36px;
        padding: 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 8px;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      .week {
        font-weight: 600;
      }
      .summary {
        padding: 12px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent);
        white-space: pre-line;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .counts a {
        display: inline-flex;
        min-height: 32px;
        align-items: center;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        color: inherit;
        text-decoration: none;
        font-size: 0.875rem;
      }
      .plans {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 10px;
      }
      figure {
        margin: 0;
        display: grid;
        gap: 4px;
      }
      figcaption {
        font-size: 0.85rem;
        color: var(--secondary-text-color, #5f6368);
      }
      svg.plan {
        width: 100%;
        height: auto;
        max-height: 320px;
      }
      .room polygon {
        fill: color-mix(in srgb, var(--secondary-text-color, #5f6368) 8%, transparent);
        stroke: var(--secondary-text-color, #5f6368);
        stroke-width: var(--line, 2);
        stroke-linejoin: round;
        cursor: pointer;
      }
      .room.tint-1 polygon {
        fill: color-mix(in srgb, #f29e2e 28%, transparent);
      }
      .room.tint-2 polygon {
        fill: color-mix(in srgb, #f29e2e 52%, transparent);
      }
      .room.tint-3 polygon {
        fill: color-mix(in srgb, #d7191c 55%, transparent);
      }
      .room[aria-pressed="true"] polygon {
        stroke: var(--primary-color, #03a9f4);
        stroke-width: calc(var(--line, 2) * 3);
      }
      .room.closed polygon {
        cursor: default;
        fill: color-mix(in srgb, var(--secondary-text-color, #5f6368) 22%, transparent);
        stroke-dasharray: calc(var(--line, 2) * 3);
      }
      .room:focus-visible {
        outline: none;
      }
      .room:focus-visible polygon {
        stroke: var(--primary-color, #03a9f4);
        stroke-dasharray: calc(var(--line, 2) * 4);
      }
      .room text {
        fill: var(--primary-text-color, #1f2328);
        text-anchor: middle;
        dominant-baseline: middle;
        pointer-events: none;
      }
      .room text.count {
        font-weight: 700;
      }
      .room text.kwh {
        fill: var(--secondary-text-color, #5f6368);
      }
      section {
        display: grid;
        gap: 6px;
      }
      ul.items {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }
      ul.items li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
        padding: 8px 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
      }
      ul.items .what {
        flex: 1 1 220px;
        display: grid;
        gap: 2px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .badge {
        display: inline-block;
        margin-inline-start: 6px;
        padding: 0 8px;
        border-radius: 999px;
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #fff);
        font-size: 0.75rem;
        vertical-align: middle;
      }
      .links {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .links a,
      .links button,
      a.open {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 32px;
        padding: 0 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--primary-color, #03a9f4);
        font: inherit;
        font-size: 0.85rem;
        text-decoration: none;
        cursor: pointer;
      }
      .links svg.icon,
      a.open svg.icon {
        width: 16px;
        height: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      th,
      td {
        padding: 6px 4px;
        text-align: end;
        border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      th:first-child,
      td:first-child {
        text-align: start;
      }
      td.up {
        color: var(--error-color, #d23a2f);
      }
      td.down {
        color: var(--success-color, #2e7d32);
      }
      .settings {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
      }
      .settings label {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .settings .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    `,
  ];

  hass?: HomeAssistant;
  /** Every storey's plan, to draw the rooms on. */
  plans: ReportPlan[] = [];
  /**
   * The private rooms the viewer may not see now (D-039): drawn closed, nothing said of what is
   * in them, their energy left out, as DomoTwin's views close them.
   */
  closed: Set<string> = new Set();
  /** The report asked for (the notification's link), else the newest. */
  asked?: number;
  protected answer?: ReportAnswer;
  /** The room whose items alone are shown. */
  protected room?: string;
  protected settingsOpen = false;
  protected draft?: ReportSettings;
  protected busy = false;
  protected error?: string;
  protected status?: string;
  private started = false;
  /** The plans' rooms, worked out again only when the plans change. */
  private drawn?: { from: ReportPlan[]; storeys: PlanStorey[] };

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** Home Assistant's states change all the time: the page reads what it needs itself. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.started);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.started && this.hass) {
      this.started = true;
      void this.read(this.asked);
    } else if (this.started && changed.has("asked") && this.asked !== undefined) {
      // Another report asked for while open (a newer notification's link).
      this.room = undefined;
      this.status = undefined;
      void this.read(this.asked);
    }
  }

  private reason(error: unknown): string {
    if (isHassError(error)) return this.t.error(error.code);
    return this.t.error("unknown");
  }

  private async read(report?: number): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    try {
      let answer: ReportAnswer;
      try {
        answer = await getReport(hass, report);
      } catch (error) {
        // A report no longer kept (an old notification's link): the newest.
        if (report === undefined || !isHassError(error) || error.code !== "unknown_report") {
          throw error;
        }
        answer = await getReport(hass);
      }
      if (!this.isConnected) return;
      this.answer = answer;
      this.error = undefined;
    } catch (error) {
      if (!this.isConnected) return;
      this.error = this.t.t("weekly.read_failed", { reason: this.reason(error) });
    }
  }

  private async write(): Promise<void> {
    const hass = this.hass;
    if (!hass || this.busy) return;
    this.busy = true;
    this.error = undefined;
    this.status = this.answer?.settings.summary
      ? this.t.t("weekly.writing_summary")
      : this.t.t("weekly.writing");
    try {
      const answer = await writeReport(hass);
      if (!this.isConnected) return;
      this.answer = answer;
      this.room = undefined;
      this.status = this.t.t("weekly.written");
    } catch (error) {
      if (!this.isConnected) return;
      this.status = undefined;
      this.error = this.t.t("weekly.write_failed", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private async saveSettings(): Promise<void> {
    const hass = this.hass;
    const draft = this.draft;
    if (!hass || !draft || this.busy) return;
    this.busy = true;
    this.error = undefined;
    try {
      const settings = await saveReportSettings(hass, draft);
      if (!this.isConnected) return;
      if (this.answer) this.answer = { ...this.answer, settings };
      this.settingsOpen = false;
      this.draft = undefined;
      this.status = this.t.t("weekly.settings.saved");
    } catch (error) {
      if (!this.isConnected) return;
      this.error = this.t.t("weekly.save_failed", { reason: this.reason(error) });
    } finally {
      this.busy = false;
    }
  }

  private close(): void {
    fire(this, "domotwin-close", undefined);
  }

  /** Frames an element of the plans (a room, a piece) in the 3D view. */
  private show(element: string): void {
    fire(this, "domotwin-show", { element });
  }

  private get moments(): Moments {
    return this.hass ? timeStyle(this.hass) : { language: this.t.language };
  }

  private storeys(): PlanStorey[] {
    if (this.drawn?.from !== this.plans) {
      this.drawn = { from: this.plans, storeys: planStoreys(this.plans) };
    }
    return this.drawn.storeys;
  }

  /** The rooms' names, by id, from the plans. */
  private roomNames(): Map<string, string> {
    return new Map(
      this.storeys().flatMap((storey) => storey.rooms.map((room) => [room.id, room.name])),
    );
  }

  /** A weekday's name, Monday 0. */
  private weekday(day: number): string {
    try {
      return new Intl.DateTimeFormat(this.t.language, { weekday: "long", timeZone: "UTC" }).format(
        new Date(Date.UTC(2024, 0, 1 + day)),
      );
    } catch {
      return String(day);
    }
  }

  /** An hour of the day, as the user's Home Assistant writes it. */
  private hour(hour: number): string {
    try {
      return new Intl.DateTimeFormat(this.t.language, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        hour12: this.moments.hour12,
      }).format(new Date(Date.UTC(2024, 0, 1, hour)));
    } catch {
      return `${hour}:00`;
    }
  }

  private weekText(span: { start: string; end: string }): string {
    const { first, last } = weekDays(span);
    const style = this.moments;
    return this.t.t("weekly.week", { first: shortDay(first, style), last: shortDay(last, style) });
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const answer = this.answer;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="report-title"
      aria-busy=${this.busy ? "true" : "false"}
      data-testid="report-dialog"
    >
      <header>
        <h2 id="report-title">${t.t("weekly.title")}</h2>
        <button
          class="round"
          data-testid="report-settings"
          aria-pressed=${this.settingsOpen ? "true" : "false"}
          aria-label=${t.t("weekly.settings_open")}
          title=${t.t("weekly.settings_open")}
          ?disabled=${!answer}
          @click=${() => {
            this.settingsOpen = !this.settingsOpen;
            this.draft = this.settingsOpen && answer ? { ...answer.settings } : undefined;
          }}
        >
          ${icon(mdiCogOutline)}
        </button>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("weekly.close")}
          title=${t.t("weekly.close")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${this.hass?.demo ? html`<p class="hint">${t.t("weekly.demo")}</p>` : nothing}
      ${this.settingsOpen && this.draft ? this.renderSettings(this.draft) : nothing}
      ${answer ? this.renderAnswer(answer) : this.error ? nothing : html`<p class="hint">${t.t("weekly.reading")}</p>`}
      <div role="status">
        ${this.status ? html`<p data-testid="report-status">${this.status}</p>` : nothing}
      </div>
      ${
        this.error
          ? html`<p class="error" role="alert" data-testid="report-error">${this.error}</p>`
          : nothing
      }
    </div>`;
  }

  private renderAnswer(answer: ReportAnswer): TemplateResult {
    const t = this.t;
    const report = answer.report;
    const settings = answer.settings;
    const pick =
      answer.reports.length > 1 && report
        ? html`<label class="meta">
            ${t.t("weekly.pick")}
            <select
              data-testid="report-pick"
              .value=${String(report.id)}
              ?disabled=${this.busy}
              @change=${(event: Event) => {
                this.room = undefined;
                this.status = undefined;
                void this.read(Number((event.target as HTMLSelectElement).value));
              }}
            >
              ${answer.reports.map((entry) => {
                const week = this.weekText(entry.week);
                return html`<option value=${String(entry.id)} ?selected=${entry.id === report.id}>
                  ${entry.by === "hand" ? t.t("weekly.by_hand", { week }) : week}
                </option>`;
              })}
            </select>
          </label>`
        : nothing;
    return html`<div class="bar">
        ${pick}
        <button
          class="action quiet"
          data-testid="report-write"
          ?disabled=${this.busy}
          @click=${() => {
            void this.write();
          }}
        >
          ${t.t("weekly.write")}
        </button>
      </div>
      ${
        report
          ? this.renderReport(report)
          : html`<p data-testid="report-none">
              ${
                settings.weekly
                  ? t.t("weekly.none", {
                      day: this.weekday(settings.weekday),
                      hour: this.hour(settings.hour),
                    })
                  : t.t("weekly.none_off")
              }
            </p>`
      }`;
  }

  private renderReport(report: Report): TemplateResult {
    const t = this.t;
    const style = this.moments;
    const total = totalOf(report);
    return html`<div>
        <p class="week" data-testid="report-week">${this.weekText(report.week)}</p>
        <p class="meta">
          ${t.t("weekly.written_at", {
            when: `${dayText(report.at, style)} ${hourText(report.at, style)}`,
          })}
        </p>
      </div>
      ${this.renderSummary(report)}
      ${
        total === 0
          ? html`<p data-testid="report-nothing">${t.t("weekly.nothing")}</p>`
          : html`<ul class="counts" data-testid="report-counts">
              ${REPORT_SECTIONS.filter((section) => countOf(report, section) > 0).map(
                (section) =>
                  html`<li>
                    <a
                      href=${`#report-${section}`}
                      data-count=${section}
                      @click=${(event: MouseEvent) => {
                        event.preventDefault();
                        this.room = undefined;
                        void this.updateComplete.then(() =>
                          this.renderRoot
                            .querySelector(`[data-section="${section}"]`)
                            ?.scrollIntoView({ block: "start", behavior: "smooth" }),
                        );
                      }}
                      >${t.tp(`weekly.counts.${section}`, countOf(report, section))}</a
                    >
                  </li>`,
              )}
            </ul>`
      }
      ${this.renderPlans(report)}
      ${REPORT_SECTIONS.map((section) => this.renderSection(report, section))}
      ${this.renderEnergy(report)} ${this.renderClosed(report)} ${this.renderPeaks(report)}
      ${this.renderDone(report)}`;
  }

  private renderSummary(report: Report): TemplateResult | typeof nothing {
    const summary = report.summary;
    if (!summary?.by) return nothing;
    const t = this.t;
    const name = this.entityName(summary.by);
    if (summary.text) {
      return html`<div class="summary" data-testid="report-summary">
        <p>${summary.text}</p>
        <p class="meta">${t.t("weekly.summary_by", { name })}</p>
      </div>`;
    }
    const known =
      summary.error === "no_ai_task" || summary.error === "timeout" || summary.error === "empty";
    const reason = known
      ? t.t(`weekly.summary_reasons.${summary.error as "no_ai_task" | "timeout" | "empty"}`)
      : (summary.error ?? "");
    return html`<p class="hint" data-testid="report-summary-failed">
      ${t.t("weekly.summary_failed", { name, reason })}
    </p>`;
  }

  private entityName(id: string): string {
    const name = this.hass?.states[id]?.attributes.friendly_name;
    return typeof name === "string" && name ? name : id;
  }

  /** The plans, each room tinted by how many things need a look in it, and its week's energy. */
  private renderPlans(report: Report): TemplateResult | typeof nothing {
    const storeys = this.storeys();
    if (storeys.length === 0) return nothing;
    const t = this.t;
    const rooms = itemsByRoom(report);
    const energy = report.energy?.rooms ?? {};
    const names = this.roomNames();
    const placed = [...rooms.values()].reduce((sum, items) => sum + items.length, 0);
    const listed = REPORT_SECTIONS.reduce(
      (sum, section) => sum + (report.sections[section]?.length ?? 0),
      0,
    );
    const room = this.room;
    return html`<section data-testid="report-plans">
      <h3>${t.t("weekly.plan.title")}</h3>
      <p class="hint">${t.t("weekly.plan.hint")}</p>
      <div class="plans">
        ${storeys.map((storey) => this.renderStorey(storey, rooms, energy, storeys.length > 1))}
      </div>
      ${
        room
          ? html`<div class="links">
              <span class="meta" data-testid="report-room">
                ${t.t("weekly.plan.only", { room: names.get(room) ?? room })}
              </span>
              <button
                data-testid="report-all-rooms"
                @click=${() => {
                  this.room = undefined;
                }}
              >
                ${t.t("weekly.plan.all")}
              </button>
              <button
                data-testid="report-show-room"
                @click=${() => {
                  this.show(room);
                }}
              >
                ${icon(mdiCubeOutline)}${t.t("weekly.show")}
              </button>
            </div>`
          : listed > placed
            ? html`<p class="hint">${t.tp("weekly.plan.elsewhere", listed - placed)}</p>`
            : nothing
      }
    </section>`;
  }

  private renderStorey(
    storey: PlanStorey,
    rooms: Map<string, [ReportSection, ReportItem][]>,
    energy: Record<string, EnergyPair>,
    named: boolean,
  ): TemplateResult {
    const t = this.t;
    const { x, y, width, height } = storey.box;
    const pad = Math.max(width, height) * 0.03;
    // Text and lines in the plan's units: about 1/30 of its size.
    const size = Math.max(width, height) / 30;
    const language = t.language;
    return html`<figure>
      ${named ? html`<figcaption>${storey.name}</figcaption>` : nothing}
      <svg
        class="plan"
        viewBox="${x - pad} ${y - pad} ${width + 2 * pad} ${height + 2 * pad}"
        style="--line:${size / 8}"
        role="group"
        aria-label=${storey.name}
        data-storey=${storey.storey}
      >
        ${storey.rooms.map((room) => {
          if (this.closed.has(room.id)) {
            const [cx, cy] = room.label;
            return svg`<g class="room closed" data-room=${room.id} role="img" aria-label=${t.t("weekly.plan.private", { room: room.name })}>
              <polygon points=${room.points.map((p) => p.join(",")).join(" ")}></polygon>
              <text x=${cx} y=${cy} font-size=${size}>${t.t("weekly.plan.private", { room: room.name })}</text>
            </g>`;
          }
          const count = rooms.get(room.id)?.length ?? 0;
          const kwh = energy[room.id]?.week;
          const label =
            count > 0
              ? t.tp("weekly.plan.label", count, { room: room.name })
              : t.t("weekly.plan.label_none", { room: room.name });
          const [lx, ly] = room.label;
          return svg`<g
            class="room tint-${tintOf(count)}"
            data-room=${room.id}
            data-count=${count}
            role="button"
            tabindex="0"
            aria-pressed=${this.room === room.id ? "true" : "false"}
            aria-label=${kwh === undefined ? label : `${label}, ${formatKwh(kwh, language)}`}
            @click=${() => {
              this.pickRoom(room.id);
            }}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              this.pickRoom(room.id);
            }}
          >
            <polygon points=${room.points.map((p) => p.join(",")).join(" ")}></polygon>
            <text x=${lx} y=${ly - size} font-size=${size}>${room.name}</text>
            ${count > 0 ? svg`<text class="count" x=${lx} y=${ly + size * 0.3} font-size=${size * 1.2}>${count}</text>` : nothing}
            ${kwh !== undefined ? svg`<text class="kwh" x=${lx} y=${ly + size * 1.6} font-size=${size * 0.85}>${formatKwh(kwh, language)}</text>` : nothing}
          </g>`;
        })}
      </svg>
    </figure>`;
  }

  private pickRoom(room: string): void {
    this.room = this.room === room ? undefined : room;
  }

  private renderSection(report: Report, section: ReportSection): TemplateResult | typeof nothing {
    const all = report.sections[section];
    if (!all || countOf(report, section) === 0) return nothing;
    const room = this.room;
    const seen = all.filter((item) => !item.room || !this.closed.has(item.room));
    const items = room ? seen.filter((item) => item.room === room) : seen;
    const hidden = room ? 0 : all.length - seen.length;
    if (items.length === 0 && hidden === 0) return nothing;
    const t = this.t;
    const more = room ? 0 : (report.more?.[section] ?? 0);
    const hass = this.hass;
    const outside = !hass || hass.demo === true || hass.sandbox === true;
    const extra =
      section === "batteries" && !outside && hasMaintenancePage(hass)
        ? this.renderLink({ path: "/maintenance" }, t.t("weekly.maintenance"), "report-maintenance")
        : nothing;
    return html`<section data-section=${section} id=${`report-${section}`}>
      <h3>
        ${t.t(`weekly.headings.${section}`)} (${room ? items.length : countOf(report, section)})
      </h3>
      ${extra !== nothing ? html`<div class="links">${extra}</div>` : nothing}
      <ul class="items">
        ${items.map((item) => this.renderItem(section, item, outside, Date.parse(report.at)))}
      </ul>
      ${more > 0 ? html`<p class="hint">${t.tp("weekly.more", more)}</p>` : nothing}
      ${hidden > 0 ? html`<p class="hint" data-private>${t.tp("weekly.private_items", hidden)}</p>` : nothing}
    </section>`;
  }

  private renderItem(
    section: ReportSection,
    item: ReportItem,
    outside: boolean,
    at: number,
  ): TemplateResult {
    const t = this.t;
    const names = this.roomNames();
    // As the report says it, not as it is now: an older week's device may be back since.
    const detail = itemDetail(t, section, item, this.moments, at);
    const where = item.room ? names.get(item.room) : undefined;
    const link = outside ? undefined : itemLink(section, item);
    // A piece's upkeep is framed in 3D on the piece itself; anything else, on its room.
    const shown = section === "upkeep" && item.piece ? item.piece : item.room;
    return html`<li data-key=${item.key}>
      <div class="what">
        <span>
          ${item.name}
          ${item.new ? html`<span class="badge" data-new>${t.t("weekly.new")}</span>` : nothing}
        </span>
        ${
          detail || where
            ? html`<span class="meta">${[detail, where].filter(Boolean).join(" · ")}</span>`
            : nothing
        }
      </div>
      <div class="links">
        ${link ? this.renderLink(link, t.t("weekly.open"), "report-open") : nothing}
        ${
          shown
            ? html`<button
                data-testid="report-show"
                @click=${() => {
                  this.show(shown);
                }}
              >
                ${icon(mdiCubeOutline)}${t.t("weekly.show")}
              </button>`
            : nothing
        }
      </div>
    </li>`;
  }

  /** A link into Home Assistant: a page (the dialog closes first), or an entity's dialog. */
  private renderLink(link: ItemLink, label: string, testId: string): TemplateResult {
    if ("entity" in link) {
      return html`<button
        data-testid=${testId}
        @click=${() => {
          fire(this, "hass-more-info", { entityId: link.entity });
        }}
      >
        ${icon(mdiOpenInNew)}${label}
      </button>`;
    }
    return html`<a
      class="open"
      href=${link.path}
      data-testid=${testId}
      @click=${(event: MouseEvent) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        this.close();
        navigate(link.path);
      }}
      >${icon(mdiOpenInNew)}${label}</a
    >`;
  }

  private renderEnergy(report: Report): TemplateResult | typeof nothing {
    const energy = report.energy;
    if (!energy) return nothing;
    const t = this.t;
    const names = this.roomNames();
    const rows: [string, EnergyPair, string?][] = [];
    if (energy.home) rows.push([t.t("weekly.energy.home"), energy.home]);
    if (energy.grid) rows.push([t.t("weekly.energy.grid"), energy.grid]);
    if (energy.solar) rows.push([t.t("weekly.energy.solar"), energy.solar]);
    const rooms = Object.entries(energy.rooms ?? {})
      .filter(([room]) => !this.closed.has(room) && (!this.room || room === this.room))
      .sort(([, a], [, b]) => (b.week ?? 0) - (a.week ?? 0));
    for (const [room, pair] of rooms) rows.push([names.get(room) ?? room, pair, room]);
    if (rows.length === 0) return nothing;
    return html`<section data-section="energy" data-testid="report-energy">
      <h3>${t.t("weekly.energy.title")}</h3>
      ${this.energyTable(rows)}
    </section>`;
  }

  /**
   * A workplace's energy while closed (D-088): the place's and its rooms', this week and the week
   * before, and the share of the week's.
   */
  private renderClosed(report: Report): TemplateResult | typeof nothing {
    const used = report.closed;
    if (!used?.week && !used?.before) return nothing;
    const t = this.t;
    const names = this.roomNames();
    const rows: [string, EnergyPair, string?][] = [
      [t.t("weekly.closed.place"), { week: used.week?.kwh, before: used.before?.kwh }],
    ];
    const week = used.week?.rooms ?? {};
    const before = used.before?.rooms ?? {};
    const rooms = [...new Set([...Object.keys(week), ...Object.keys(before)])]
      .filter((room) => !this.closed.has(room) && (!this.room || room === this.room))
      .sort((a, b) => (week[b] ?? 0) - (week[a] ?? 0));
    for (const room of rooms) {
      rows.push([names.get(room) ?? room, { week: week[room], before: before[room] }, room]);
    }
    const share = used.week?.share;
    const since = used.week?.since;
    return html`<section data-section="closed" data-testid="report-closed">
      <h3>${t.t("weekly.closed.title")}</h3>
      ${
        share === undefined
          ? nothing
          : html`<p class="hint">
              ${t.t("weekly.closed.share", { share: formatPercent(share, t.language) })}
            </p>`
      }
      ${
        // Counted from later than the week's start: as far back as Home Assistant's history goes.
        since === undefined
          ? nothing
          : html`<p class="hint" data-testid="report-closed-since">
              ${t.t("weekly.closed.since", { date: shortDay(since, this.moments) })}
            </p>`
      }
      ${this.energyTable(rows)}
    </section>`;
  }

  /** Energy this week and the week before, and how it changed: a row for each `[name, pair]`. */
  private energyTable(rows: [string, EnergyPair, string?][]): TemplateResult {
    const t = this.t;
    const language = t.language;
    const kwh = (value: number | undefined): string =>
      value === undefined ? t.t("weekly.energy.unknown") : formatKwh(value, language);
    return html`<table>
      <thead>
        <tr>
          <th scope="col">${t.t("weekly.energy.what")}</th>
          <th scope="col">${t.t("weekly.energy.week")}</th>
          <th scope="col">${t.t("weekly.energy.before")}</th>
          <th scope="col">${t.t("weekly.energy.change")}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(([name, pair, room]) => {
          const change = changeOf(pair);
          const said =
            change === undefined
              ? t.t("weekly.energy.unknown")
              : change === 0
                ? t.t("weekly.energy.same")
                : formatPercent(change, language, true);
          return html`<tr data-room=${room ?? nothing}>
            <th scope="row">${name}</th>
            <td>${kwh(pair.week)}</td>
            <td>${kwh(pair.before)}</td>
            <td class=${change === undefined || change === 0 ? "" : change > 0 ? "up" : "down"}>
              ${said}
            </td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  private renderPeaks(report: Report): TemplateResult | typeof nothing {
    const peaks = report.peaks;
    if (!peaks) return nothing;
    const t = this.t;
    const style = this.moments;
    const names = this.roomNames();
    const language = t.language;
    return html`<section data-section="peaks" data-testid="report-peaks">
      <h3>${t.t("weekly.peaks.title")}</h3>
      ${
        peaks.length === 0
          ? html`<p class="hint">${t.t("weekly.peaks.none")}</p>`
          : html`<ul class="items">
              ${peaks.map((peak) => {
                const rooms = Object.entries(peak.rooms ?? {})
                  .filter(([room]) => !this.closed.has(room))
                  .sort(([, a], [, b]) => b - a)
                  .map(([room, kwh]) => `${names.get(room) ?? room} ${formatKwh(kwh, language)}`);
                const parts = [
                  peak.grid === undefined
                    ? undefined
                    : t.t("weekly.peaks.drew", { kwh: formatKwh(peak.grid, language) }),
                  rooms.length ? t.t("weekly.peaks.rooms", { rooms: rooms.join(", ") }) : undefined,
                ].filter(Boolean);
                return html`<li data-peak=${peak.start}>
                  <div class="what">
                    <span>
                      ${t.t("weekly.peaks.when", {
                        day: dayText(peak.start, style),
                        start: hourText(peak.start, style),
                        end: hourText(peak.end, style),
                      })}
                    </span>
                    ${parts.length ? html`<span class="meta">${parts.join(" · ")}</span>` : nothing}
                  </div>
                </li>`;
              })}
            </ul>`
      }
    </section>`;
  }

  private renderDone(report: Report): TemplateResult | typeof nothing {
    const gone = report.gone;
    if (!gone || this.room) return nothing;
    const t = this.t;
    const lines = REPORT_SECTIONS.flatMap((section) =>
      (gone[section] ?? []).map((item) =>
        t.t("weekly.done.item", { name: item.name, what: t.t(`weekly.headings.${section}`) }),
      ),
    );
    if (lines.length === 0) return nothing;
    return html`<section data-section="done" data-testid="report-done">
      <h3>${t.t("weekly.done.title")}</h3>
      <ul class="items">
        ${lines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </section>`;
  }

  private renderSettings(draft: ReportSettings): TemplateResult {
    const t = this.t;
    const hass = this.hass;
    const tasks = aiTasks(hass);
    // One chosen before and gone since stays listed, so that it is not changed unseen.
    if (draft.summary && !tasks.includes(draft.summary)) tasks.push(draft.summary);
    const change = (patch: Partial<ReportSettings>): void => {
      this.draft = { ...draft, ...patch };
    };
    return html`<form
      class="settings"
      data-testid="report-settings-form"
      @submit=${(event: Event) => {
        event.preventDefault();
        void this.saveSettings();
      }}
    >
      <h3>${t.t("weekly.settings.title")}</h3>
      <label>
        <input
          type="checkbox"
          data-testid="report-weekly"
          .checked=${draft.weekly}
          @change=${(event: Event) => {
            change({ weekly: (event.target as HTMLInputElement).checked });
          }}
        />
        ${t.t("weekly.settings.weekly")}
      </label>
      <label>
        ${t.t("weekly.settings.day")}
        <select
          data-testid="report-weekday"
          ?disabled=${!draft.weekly}
          @change=${(event: Event) => {
            change({ weekday: Number((event.target as HTMLSelectElement).value) });
          }}
        >
          ${[0, 1, 2, 3, 4, 5, 6].map(
            (day) =>
              html`<option value=${String(day)} ?selected=${draft.weekday === day}>
                ${this.weekday(day)}
              </option>`,
          )}
        </select>
        ${t.t("weekly.settings.hour")}
        <select
          data-testid="report-hour"
          ?disabled=${!draft.weekly}
          @change=${(event: Event) => {
            change({ hour: Number((event.target as HTMLSelectElement).value) });
          }}
        >
          ${Array.from(
            { length: 24 },
            (_, hour) =>
              html`<option value=${String(hour)} ?selected=${draft.hour === hour}>
                ${this.hour(hour)}
              </option>`,
          )}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="report-notify"
          .checked=${draft.notify}
          ?disabled=${!draft.weekly}
          @change=${(event: Event) => {
            change({ notify: (event.target as HTMLInputElement).checked });
          }}
        />
        ${t.t("weekly.settings.notify")}
      </label>
      <p class="hint">${t.t("weekly.settings.notify_hint")}</p>
      <label>
        ${t.t("weekly.settings.summary")}
        <select
          data-testid="report-summary-by"
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            change({ summary: value || null });
          }}
        >
          <option value="" ?selected=${!draft.summary}>
            ${t.t("weekly.settings.summary_none")}
          </option>
          ${tasks.map(
            (id) =>
              html`<option value=${id} ?selected=${draft.summary === id}>
                ${this.entityName(id)}
              </option>`,
          )}
        </select>
      </label>
      ${draft.summary ? html`<p class="hint">${t.t("weekly.settings.summary_hint")}</p>` : nothing}
      <label>
        ${t.t("weekly.settings.battery")}
        <input
          type="number"
          min="1"
          max="99"
          step="1"
          data-testid="report-battery"
          .value=${String(draft.battery)}
          @change=${(event: Event) => {
            const value = Math.round(Number((event.target as HTMLInputElement).value));
            change({ battery: Math.min(Math.max(Number.isFinite(value) ? value : 20, 1), 99) });
          }}
        />
      </label>
      <div class="footer">
        <button
          type="button"
          class="action quiet"
          @click=${() => {
            this.settingsOpen = false;
            this.draft = undefined;
          }}
        >
          ${t.t("weekly.settings.cancel")}
        </button>
        <button type="submit" class="action" data-testid="report-save" ?disabled=${this.busy}>
          ${t.t("weekly.settings.save")}
        </button>
      </div>
    </form>`;
  }
}

define("domotwin-report", DomoTwinReport);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-report": DomoTwinReport;
  }
}
