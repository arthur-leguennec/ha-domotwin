/**
 * `<domotwin-plain>`: an automation in plain words (D-070). One says what should happen; Home
 * Assistant's AI task writes the automation; DomoTwin says it back in plain words, has Home
 * Assistant check it, plays it in the sandbox on the days one picks, and only then saves it, Home
 * Assistant's editor a tap away. For administrators, where Home Assistant has an AI task. The
 * draft is the panel's (`PlainSession`), kept across the sandbox and back; loaded, with its texts,
 * when first opened.
 */
import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiClose,
  mdiContentCopy,
  mdiOpenInNew,
  mdiTestTube,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { isHassError, type HomeAssistant } from "../ha/types";
import { addMessages, translatorFor, type Translator } from "../i18n";
import { plainEn, plainFr } from "../i18n/plain";
import { navigate } from "../live/actions";
import { aiTasks } from "../live/ai-task";
import { entityName } from "../live/bindings";
import { refusal } from "../live/refusal";
import {
  MAX_REQUEST,
  askAiTask,
  checkWithHomeAssistant,
  draftEntityId,
  editorOf,
  hasUnknown,
  instructionsFor,
  preferredAiTask,
  readAnswer,
  saveAutomation,
  savedConfig,
  taskHome,
  unknownNames,
  type AnswerProblem,
  type CheckProblem,
  type PlainDraft,
  type TaskHome,
  type UnknownNames,
} from "../live/plain-request";
import { automationWords, type AutomationWords, type WordsLine } from "../live/plain-words";
import type { Unseen } from "../live/privacy";
import type { DraftDay } from "../sandbox/home";
import { define, fire } from "./define";
import { icon } from "./icon";
import { baseStyles } from "./styles";

addMessages({ en: plainEn, fr: plainFr });

/** At most this many days played are kept with a draft: the latest. */
const MAX_DAYS = 10;
/** At most this many times of a day's runs are said. */
const TIMES_SAID = 5;

/** What Home Assistant and DomoTwin found of a draft. */
export type DraftCheck =
  { problems: CheckProblem[]; unknown: UnknownNames } | { failed: string; unknown: UnknownNames };

/**
 * An automation being written in plain words: the request and the changes asked, the AI task
 * chosen, the draft, what was found of it, the days it was played, and once saved, its id. The
 * panel keeps it while it is open, so that it outlives the dialog and the sandbox.
 */
export class PlainSession {
  request = "";
  changes: string[] = [];
  task?: string;
  draft?: PlainDraft;
  /** What the AI task answered, when it could not be read as an automation. */
  unread?: { problem: AnswerProblem; raw: string };
  /** Counts the drafts: the days played belong to one. */
  revision = 0;
  check?: DraftCheck;
  days: DraftDay[] = [];
  saved?: { id: string; name: string };
  /** The save under way, kept here so that a dialog opened again does not save it twice. */
  saving?: Promise<void>;
  /** Why Home Assistant did not save it. */
  saveError?: string;

  /** The description saved: the request, then each change asked, in the user's words. */
  get description(): string {
    return [this.request, ...this.changes]
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n");
  }

  /** A new draft: checked again, played again. */
  setDraft(draft: PlainDraft): void {
    this.draft = draft;
    this.unread = undefined;
    this.revision += 1;
    this.check = undefined;
    this.days = [];
  }

  /** A day the draft `revision` was played: the same day played again (things done by hand in
   * it, or none) replaces it. */
  addDay(day: DraftDay, revision: number): void {
    if (revision !== this.revision) return;
    this.days = [...this.days.filter((each) => each.key !== day.key), day].slice(-MAX_DAYS);
  }

  /** Whether it may be saved: checked with nothing wrong, played as it is now. */
  get checked(): boolean {
    const check = this.check;
    return (
      check !== undefined &&
      !("failed" in check) &&
      check.problems.length === 0 &&
      !hasUnknown(check.unknown)
    );
  }

  get played(): boolean {
    return this.days.length > 0;
  }

  /** Back to an empty request; the AI task chosen stays. */
  clear(): void {
    this.request = "";
    this.changes = [];
    this.draft = undefined;
    this.unread = undefined;
    this.check = undefined;
    this.days = [];
    this.saved = undefined;
    this.saveError = undefined;
  }
}

/** What is being done: written by the AI task, or checked (a save is the session's). */
type Busy = "writing" | "checking";

export class DomoTwinPlain extends LitElement {
  static override properties = {
    hass: { attribute: false },
    session: { attribute: false },
    unseen: { attribute: false },
    busy: { state: true },
    error: { state: true },
    status: { state: true },
    change: { state: true },
    tasks: { state: true },
    showWhole: { state: true },
    announced: { state: true },
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
        width: min(640px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        overflow: auto;
        box-sizing: border-box;
        padding: 16px;
        display: grid;
        gap: 12px;
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
        margin: 4px 0 0;
        font-size: 0.95rem;
        font-weight: 600;
      }
      h4 {
        margin: 6px 0 2px;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--secondary-text-color, #5f6368);
      }
      p {
        margin: 0;
      }
      .hint {
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.85rem;
      }
      .error {
        color: var(--error-color, #d23a2f);
      }
      .ok {
        color: var(--success-color, #2e7d32);
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
      label {
        display: grid;
        gap: 4px;
        font-size: 0.875rem;
        font-weight: 500;
      }
      textarea,
      input[type="text"],
      select {
        box-sizing: border-box;
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        font-weight: 400;
      }
      textarea {
        min-height: 4.5em;
        resize: vertical;
      }
      ul {
        margin: 0;
        padding-inline-start: 20px;
        display: grid;
        gap: 2px;
      }
      li {
        overflow-wrap: anywhere;
      }
      li.unknown > .text {
        color: var(--error-color, #d23a2f);
      }
      .badge {
        margin-inline-start: 6px;
        padding: 1px 8px;
        border-radius: 999px;
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
        color: var(--secondary-text-color, #5f6368);
        font-size: 0.75rem;
        font-weight: 500;
      }
      .badge.unknown {
        color: var(--error-color, #d23a2f);
      }
      .box {
        display: grid;
        gap: 6px;
        padding: 10px 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
      }
      blockquote {
        margin: 0;
        padding-inline-start: 10px;
        border-inline-start: 3px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        white-space: pre-wrap;
      }
      .line {
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }
      .line svg.icon {
        flex: none;
        width: 18px;
        height: 18px;
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      button.action:disabled {
        opacity: 0.5;
        cursor: default;
        filter: none;
        transform: none;
      }
      a.open {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--primary-color, #03a9f4);
        font-size: 0.875rem;
      }
      a.open svg.icon {
        width: 16px;
        height: 16px;
      }
      details pre {
        max-height: 40vh;
        overflow: auto;
        margin: 6px 0 0;
        padding: 8px;
        border-radius: 8px;
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
        font-size: 0.75rem;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        user-select: text;
      }
      summary {
        cursor: pointer;
        font-size: 0.875rem;
      }
    `,
  ];

  hass?: HomeAssistant;
  /** The draft, kept by the panel. */
  session = new PlainSession();
  /**
   * What the viewer may not see (D-039), never named to the AI task; none until the panel has
   * read the home's settings, plans and links, and nothing is asked of the AI task meanwhile.
   */
  unseen?: Unseen;
  protected busy?: Busy;
  protected error?: string;
  protected status?: string;
  /** The change being written. */
  protected change = "";
  /** The AI tasks there are, read when the dialog opens. */
  protected tasks: string[] = [];
  protected showWhole = false;
  /** Said to screen readers when the dialog shows something new (a draft written). */
  protected announced = "";
  private started = false;
  /** Where the focus goes once drawn, when what had it is gone. */
  private focusNext?: string;
  /** Counts the questions to the AI task: an answer to one cancelled is dropped. */
  private asked = 0;
  private home?: TaskHome;
  /** The draft's words, worked out once for each draft (and language). */
  private said?: { config: PlainDraft["config"]; language: string; words: AutomationWords };

  private get t(): Translator {
    return translatorFor(this.hass);
  }

  /** Home Assistant's states change all the time: the dialog reads what it needs itself. */
  override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !(changed.size === 1 && changed.has("hass") && this.started);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // What the viewer may not see changed (the home read): the home is told afresh.
    if (changed.has("unseen")) this.home = undefined;
    const hass = this.hass;
    if (this.started || !hass) return;
    this.started = true;
    this.tasks = aiTasks(hass);
    if (!this.session.task || !this.tasks.includes(this.session.task)) {
      const first = this.tasks[0];
      this.session.task = first;
      // The one Home Assistant prefers, unless another was chosen meanwhile.
      void preferredAiTask(hass, this.tasks).then((preferred) => {
        if (preferred && this.isConnected && this.session.task === first) {
          this.session.task = preferred;
          this.requestUpdate();
        }
      });
    }
    // A draft is checked again when the dialog opens again: a check that had not come back or
    // failed, a name since added in Home Assistant.
    if (this.session.draft && !this.session.saved) void this.check();
    // A save still under way when the dialog was closed.
    void this.session.saving?.then(() => {
      const saved = this.session.saved;
      if (saved && this.isConnected) {
        this.announced = this.t.t("plain.saved", { name: saved.name });
        this.focusNext = '[data-testid="plain-another"]';
      }
      this.requestUpdate();
    });
  }

  override updated(): void {
    if (!this.focusNext) return;
    const target = this.renderRoot.querySelector<HTMLElement>(this.focusNext);
    this.focusNext = undefined;
    target?.focus();
  }

  /** The home as the AI task is told it, worked out when the dialog opens and before a question. */
  private taskHome(fresh = false): TaskHome | undefined {
    const hass = this.hass;
    const unseen = this.unseen;
    if (!hass || !unseen) return undefined;
    if (fresh || !this.home) this.home = taskHome(hass, unseen);
    return this.home;
  }

  private reason(error: unknown): string {
    if (isHassError(error)) return error.message || this.t.error(error.code);
    return refusal(error) ?? this.t.error(error instanceof Error ? error.name : "unknown");
  }

  private taskName(id: string | undefined): string {
    return id && this.hass ? entityName(this.hass, id) : "";
  }

  private close(): void {
    // A question still on its way: its answer is dropped.
    this.asked += 1;
    fire(this, "domotwin-close", undefined);
  }

  /** Asks the AI task for the automation, or for the draft changed as `change` says. */
  private async write(change?: string): Promise<void> {
    const hass = this.hass;
    const session = this.session;
    const task = session.task;
    const t = this.t;
    if (!task || !this.tasks.includes(task)) {
      this.error = t.t("plain.no_task");
      return;
    }
    const home = this.taskHome(true);
    if (!hass || !home || this.busy) return;
    const draft = session.draft;
    const instructions = instructionsFor(
      hass,
      home,
      session.request,
      change !== undefined && draft ? { draft, asked: change } : undefined,
    );
    this.asked += 1;
    const asked = this.asked;
    this.busy = "writing";
    this.error = undefined;
    this.status = undefined;
    let data: unknown;
    try {
      data = await askAiTask(hass, task, instructions);
    } catch (error) {
      if (asked !== this.asked) return;
      this.busy = undefined;
      this.error = t.t("plain.failed", { reason: this.reason(error) });
      return;
    }
    if (asked !== this.asked) return;
    this.busy = undefined;
    const read = readAnswer(data);
    if ("problem" in read) {
      session.unread = { problem: read.problem, raw: rawText(data) };
      this.requestUpdate();
      return;
    }
    if (change !== undefined) {
      session.changes = [...session.changes, change.trim()];
      this.change = "";
    }
    session.setDraft({ ...read.draft, name: read.draft.name || t.t("plain.unnamed") });
    this.showWhole = false;
    // What had the focus (Write it, Change it) may be gone: the new draft's name has it.
    this.announced = t.t("plain.written", { name: session.draft?.name ?? "" });
    this.focusNext = '[data-testid="plain-name"]';
    this.requestUpdate();
    await this.check();
  }

  /** What the draft names that Home Assistant lacks, and Home Assistant's own check. */
  private async check(): Promise<void> {
    const hass = this.hass;
    const session = this.session;
    const draft = session.draft;
    if (!hass || !draft) return;
    const revision = session.revision;
    const unknown = unknownNames(hass, draft.config);
    this.busy = "checking";
    let check: DraftCheck;
    try {
      check = { problems: await checkWithHomeAssistant(hass, draft.config), unknown };
    } catch (error) {
      check = { failed: this.reason(error), unknown };
    }
    this.busy = undefined;
    if (revision !== session.revision) return;
    session.check = check;
    this.requestUpdate();
  }

  /** Plays the draft in the sandbox, beside the home's automations: the panel opens it. */
  private play(): void {
    const hass = this.hass;
    const draft = this.session.draft;
    if (!hass || !draft) return;
    // An entity of its own, none of the home's, as Home Assistant would name it.
    const entity = draftEntityId(draft.name, (id) => hass.states[id] !== undefined);
    fire(this, "domotwin-plain-play", { entity, name: draft.name, config: draft.config });
  }

  private async save(): Promise<void> {
    const hass = this.hass;
    const session = this.session;
    const draft = session.draft;
    if (!hass || !draft || !session.checked || !session.played || this.busy || session.saving) {
      return;
    }
    const t = this.t;
    this.error = undefined;
    this.status = undefined;
    session.saveError = undefined;
    const name = draft.name;
    session.saving = saveAutomation(hass, savedConfig(draft, session.description))
      .then(
        (id) => {
          session.saved = { id, name };
        },
        (error: unknown) => {
          session.saveError = t.t("plain.save_failed", { reason: this.reason(error) });
        },
      )
      .finally(() => {
        session.saving = undefined;
      });
    this.requestUpdate();
    await session.saving;
    if (!this.isConnected) return;
    if (session.saved) {
      this.announced = t.t("plain.saved", { name });
      this.focusNext = '[data-testid="plain-another"]';
    }
    this.requestUpdate();
  }

  /** Back to an empty request, its field focused. */
  private startOver(): void {
    this.session.clear();
    this.change = "";
    this.status = undefined;
    this.error = undefined;
    this.announced = "";
    this.focusNext = '[data-testid="plain-request"]';
    this.requestUpdate();
  }

  private async copy(): Promise<void> {
    const draft = this.session.draft;
    if (!draft) return;
    const text = JSON.stringify(savedConfig(draft, this.session.description), null, 2);
    const t = this.t;
    try {
      await navigator.clipboard.writeText(text);
      this.status = t.t("plain.copied");
    } catch {
      // The companion apps may refuse the clipboard: the configuration, shown, to copy by hand.
      this.showWhole = true;
      this.status = t.t("plain.copy_failed");
    }
  }

  private openEditor(event: MouseEvent, path: string): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.close();
    navigate(path);
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const session = this.session;
    return html`<div
      class="dialog glass"
      role="dialog"
      aria-labelledby="plain-title"
      aria-busy=${this.busy ? "true" : "false"}
      data-testid="plain-dialog"
    >
      <header>
        <h2 id="plain-title">${t.t("plain.title")}</h2>
        <button
          class="round"
          data-cancel
          aria-label=${t.t("plain.close")}
          title=${t.t("plain.close")}
          @click=${() => {
            this.close();
          }}
        >
          ${icon(mdiClose)}
        </button>
      </header>
      ${session.saved ? this.renderSaved(session.saved) : session.draft ? this.renderDraft(session.draft) : this.renderAsk()}
      <div role="status">
        ${this.busy === "writing" ? this.renderWriting() : nothing}
        ${this.status ? html`<p data-testid="plain-status">${this.status}</p>` : nothing}
        <span class="hidden-text">${this.announced}</span>
      </div>
      ${
        (this.error ?? session.saveError)
          ? html`<p class="error" role="alert" data-testid="plain-error">
              ${this.error ?? session.saveError}
            </p>`
          : nothing
      }
    </div>`;
  }

  private renderWriting(): TemplateResult {
    const t = this.t;
    return html`<div class="footer">
      <p class="hint" data-testid="plain-writing">
        ${t.t("plain.writing", { task: this.taskName(this.session.task) })}
      </p>
      <button
        class="action quiet"
        data-testid="plain-cancel"
        @click=${() => {
          this.asked += 1;
          this.busy = undefined;
        }}
      >
        ${t.t("plain.cancel")}
      </button>
    </div>`;
  }

  /** The AI task to write it, when there are several, and what goes to it. */
  private renderTask(): TemplateResult {
    const t = this.t;
    const session = this.session;
    const home = this.taskHome();
    if (this.tasks.length === 0) {
      return html`<p class="error" role="alert" data-testid="plain-no-task">
        ${t.t("plain.no_task")}
      </p>`;
    }
    return html`${
      this.tasks.length > 1
        ? html`<label>
            ${t.t("plain.task")}
            <select
              data-testid="plain-task"
              ?disabled=${this.busy !== undefined}
              @change=${(event: Event) => {
                session.task = (event.target as HTMLSelectElement).value;
                this.requestUpdate();
              }}
            >
              ${this.tasks.map(
                (id) =>
                  html`<option value=${id} ?selected=${id === session.task}>
                    ${this.taskName(id)}
                  </option>`,
              )}
            </select>
          </label>`
        : nothing
    }
    ${
      home
        ? html`<p class="hint" data-testid="plain-sent">
            ${t.tp("plain.sent", home.entities, { task: this.taskName(session.task) })}
            ${home.entities < home.total ? t.t("plain.sent_cut", { total: home.total }) : nothing}
          </p>`
        : html`<p class="hint" data-testid="plain-reading">${t.t("plain.reading")}</p>`
    }`;
  }

  private renderAsk(): TemplateResult {
    const t = this.t;
    const session = this.session;
    const long = session.request.length > MAX_REQUEST;
    const unread = session.unread;
    return html`<p class="hint">${t.t("plain.intro")}</p>
      <label>
        ${t.t("plain.request")}
        <textarea
          data-autofocus
          data-testid="plain-request"
          rows="3"
          placeholder=${t.t("plain.request_hint")}
          .value=${session.request}
          ?disabled=${this.busy !== undefined}
          @input=${(event: Event) => {
            session.request = (event.target as HTMLTextAreaElement).value;
            this.requestUpdate();
          }}
        ></textarea>
      </label>
      ${long ? html`<p class="error">${t.t("plain.too_long", { max: MAX_REQUEST })}</p>` : nothing}
      ${this.renderTask()}
      ${
        unread
          ? html`<div class="box" data-testid="plain-unread">
              <p class="error">${t.t(`plain.problem.${unread.problem}`)}</p>
              ${
                unread.raw
                  ? html`<details>
                      <summary>${t.t("plain.answer")}</summary>
                      <pre>${unread.raw}</pre>
                    </details>`
                  : nothing
              }
            </div>`
          : nothing
      }
      <div class="footer">
        <button
          class="action"
          data-testid="plain-write"
          ?disabled=${
            this.busy !== undefined ||
            !session.request.trim() ||
            long ||
            this.tasks.length === 0 ||
            !this.unseen
          }
          @click=${() => {
            void this.write();
          }}
        >
          ${t.t("plain.write")}
        </button>
      </div>`;
  }

  private renderLines(lines: readonly WordsLine[]): TemplateResult {
    const t = this.t;
    return html`<ul>
      ${lines.map(
        (line) =>
          html`<li class=${line.unknown ? "unknown" : ""}>
            <span class="text">${line.text}</span>
            ${line.off ? html`<span class="badge">${t.t("plain.off")}</span>` : nothing}
            ${line.unknown ? html`<span class="badge unknown">${t.t("plain.unknown")}</span>` : nothing}
            ${line.lines ? this.renderLines(line.lines) : nothing}
          </li>`,
      )}
    </ul>`;
  }

  /** What the draft does, in plain words. */
  private renderWords(draft: PlainDraft): TemplateResult {
    const t = this.t;
    const hass = this.hass;
    if (!hass) return html``;
    if (this.said?.config !== draft.config || this.said.language !== t.language) {
      this.said = {
        config: draft.config,
        language: t.language,
        words: automationWords(t, hass, draft.config),
      };
    }
    const words = this.said.words;
    return html`<section class="box" aria-labelledby="plain-does" data-testid="plain-words">
      <h3 id="plain-does">${t.t("plain.does")}</h3>
      <h4>${t.t("plain.when")}</h4>
      <div data-testid="plain-when">${this.renderLines(words.when)}</div>
      ${
        words.onlyIf.length > 0
          ? html`<h4>${t.t("plain.only_if")}</h4>
              <div data-testid="plain-only-if">${this.renderLines(words.onlyIf)}</div>`
          : nothing
      }
      <h4>${t.t("plain.then")}</h4>
      <div data-testid="plain-then">${this.renderLines(words.then)}</div>
      ${words.mode ? html`<p class="hint">${t.t("plain.mode", { mode: words.mode })}</p>` : nothing}
    </section>`;
  }

  /** What Home Assistant found, and what it does not have. */
  private renderCheck(): TemplateResult {
    const t = this.t;
    const check = this.session.check;
    const lines: TemplateResult[] = [];
    if (check) {
      if ("failed" in check) {
        lines.push(
          html`<li class="error">${t.t("plain.check_failed", { reason: check.failed })}</li>`,
        );
      } else {
        for (const problem of check.problems) {
          lines.push(
            html`<li class="error">
              ${t.t(`plain.part.${problem.part}`, { error: problem.error })}
            </li>`,
          );
        }
      }
      for (const kind of ["entities", "areas", "devices", "floors", "actions"] as const) {
        const names = check.unknown[kind];
        if (names.length > 0) {
          lines.push(
            html`<li class="error">
              ${t.t(`plain.missing.${kind}`, { names: names.join(", ") })}
            </li>`,
          );
        }
      }
    }
    const dropped = this.session.draft?.dropped;
    return html`<section class="box" aria-labelledby="plain-check" data-testid="plain-check">
      <h3 id="plain-check">${t.t("plain.check")}</h3>
      ${
        !check
          ? html`<p class="hint">${t.t("plain.checking")}</p>`
          : lines.length === 0
            ? html`<p class="line ok" data-testid="plain-check-ok">
                ${icon(mdiCheckCircleOutline)}${t.t("plain.check_ok")}
              </p>`
            : html`<div class="line error">
                  ${icon(mdiAlertCircleOutline)}
                  <ul data-testid="plain-check-problems">
                    ${lines}
                  </ul>
                </div>
                <div class="footer">
                  <button
                    class="action quiet"
                    data-testid="plain-check-again"
                    ?disabled=${this.busy !== undefined}
                    @click=${() => {
                      void this.check();
                    }}
                  >
                    ${t.t("plain.check_again")}
                  </button>
                </div>`
      }
      ${
        dropped
          ? html`<p class="hint" data-testid="plain-dropped">
              ${t.t("plain.dropped", { keys: dropped.join(", ") })}
            </p>`
          : nothing
      }
    </section>`;
  }

  /** A day as the dialog says it: "Tuesday 27 October", in the user's language. */
  private date(date: string): string {
    const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!found) return date;
    try {
      return new Intl.DateTimeFormat(this.t.language, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]))));
    } catch {
      return date;
    }
  }

  /** What the draft did on a day played. */
  private dayResult(day: DraftDay): string {
    const t = this.t;
    const hass = this.hass;
    const parts: string[] = [];
    const runs = day.runs.length;
    if (runs > 0) {
      parts.push(
        runs <= TIMES_SAID
          ? t.tp("plain.result.ran", runs, { times: day.runs.join(", ") })
          : t.tp("plain.result.ran_more", runs, { times: day.runs[0] ?? "" }),
      );
    } else if (day.stopped > 0) parts.push(t.tp("plain.result.stopped", day.stopped));
    else if (day.busy > 0) parts.push(t.tp("plain.result.busy", day.busy));
    else parts.push(t.t("plain.result.never"));
    if (day.against.length > 0) {
      const names = day.against.map((id) => (hass ? entityName(hass, id) : id));
      parts.push(t.t("plain.result.against", { names: names.join(", ") }));
    }
    if (day.looping) parts.push(t.t("plain.result.looping"));
    if (day.notPlayed > 0) parts.push(t.tp("plain.result.not_played", day.notPlayed));
    if (day.byHand > 0) parts.push(t.tp("plain.result.by_hand", day.byHand));
    return parts.join("; ");
  }

  /** The days it was played in the sandbox, and the way there. */
  private renderPlayed(): TemplateResult {
    const t = this.t;
    const session = this.session;
    return html`<section class="box" aria-labelledby="plain-played" data-testid="plain-played">
      <h3 id="plain-played">${t.t("plain.played")}</h3>
      ${
        session.days.length === 0
          ? html`<p class="hint">${t.t("plain.played_none")}</p>`
          : html`<ul data-testid="plain-days">
              ${session.days.map(
                (day) =>
                  html`<li>
                    ${t.t("plain.day", {
                      date: this.date(day.date),
                      weather: t.t(`plain.weather.${day.weather}`),
                      result: this.dayResult(day),
                    })}
                  </li>`,
              )}
            </ul>`
      }
      <div class="footer">
        <button
          class="action quiet"
          data-testid="plain-play"
          ?disabled=${this.busy !== undefined}
          @click=${() => {
            this.play();
          }}
        >
          ${icon(mdiTestTube)}${t.t("plain.play")}
        </button>
      </div>
    </section>`;
  }

  private renderDraft(draft: PlainDraft): TemplateResult {
    const t = this.t;
    const session = this.session;
    const whole = JSON.stringify(savedConfig(draft, session.description), null, 2);
    const ready = session.checked && session.played;
    const editor = editorOf();
    return html`<label>
        ${t.t("plain.name")}
        <input
          type="text"
          data-autofocus
          data-testid="plain-name"
          maxlength="120"
          .value=${draft.name}
          ?disabled=${this.busy === "writing"}
          @change=${(event: Event) => {
            const name = (event.target as HTMLInputElement).value.trim();
            draft.name = name || t.t("plain.unnamed");
            this.requestUpdate();
          }}
        />
      </label>
      ${this.renderWords(draft)}
      ${
        draft.notes
          ? html`<section class="box" data-testid="plain-notes">
              <h3>${t.t("plain.notes")}</h3>
              <blockquote>${draft.notes}</blockquote>
            </section>`
          : nothing
      }
      ${this.renderCheck()} ${this.renderPlayed()}
      <label>
        ${t.t("plain.change")}
        <textarea
          data-testid="plain-change"
          rows="2"
          placeholder=${t.t("plain.change_hint")}
          .value=${this.change}
          ?disabled=${this.busy !== undefined}
          @input=${(event: Event) => {
            this.change = (event.target as HTMLTextAreaElement).value;
          }}
        ></textarea>
      </label>
      ${this.change.length > MAX_REQUEST ? html`<p class="error">${t.t("plain.too_long", { max: MAX_REQUEST })}</p>` : nothing}
      ${
        session.unread
          ? html`<div class="box" data-testid="plain-unread">
              <p class="error">${t.t(`plain.problem.${session.unread.problem}`)}</p>
              ${
                session.unread.raw
                  ? html`<details>
                      <summary>${t.t("plain.answer")}</summary>
                      <pre>${session.unread.raw}</pre>
                    </details>`
                  : nothing
              }
            </div>`
          : nothing
      }
      ${this.renderTask()}
      <div class="footer">
        <button
          class="action quiet"
          data-testid="plain-change-button"
          ?disabled=${
            this.busy !== undefined ||
            !this.change.trim() ||
            this.change.length > MAX_REQUEST ||
            this.tasks.length === 0 ||
            !this.unseen
          }
          @click=${() => {
            void this.write(this.change);
          }}
        >
          ${t.t("plain.change_button")}
        </button>
      </div>
      <details
        .open=${this.showWhole}
        @toggle=${(event: Event) => {
          this.showWhole = (event.target as HTMLDetailsElement).open;
        }}
      >
        <summary>${t.t("plain.whole")}</summary>
        <pre data-testid="plain-whole">${whole}</pre>
      </details>
      ${
        ready
          ? nothing
          : html`<p class="hint" data-testid="plain-save-why">
              ${t.t(session.checked ? "plain.save_play" : "plain.save_check")}
            </p>`
      }
      <div class="footer">
        <button
          class="action quiet"
          data-testid="plain-start-over"
          ?disabled=${this.busy !== undefined}
          @click=${() => {
            this.startOver();
          }}
        >
          ${t.t("plain.start_over")}
        </button>
        <button
          class="action quiet"
          data-testid="plain-copy"
          @click=${() => {
            void this.copy();
          }}
        >
          ${icon(mdiContentCopy)}${t.t("plain.copy")}
        </button>
        <a
          class="open"
          href=${editor}
          data-testid="plain-editor"
          @click=${(event: MouseEvent) => {
            this.openEditor(event, editor);
          }}
          >${icon(mdiOpenInNew)}${t.t("plain.editor_new")}</a
        >
        <button
          class="action"
          data-testid="plain-save"
          ?disabled=${!ready || this.busy !== undefined || session.saving !== undefined}
          @click=${() => {
            void this.save();
          }}
        >
          ${session.saving ? t.t("plain.saving") : t.t("plain.save")}
        </button>
      </div>`;
  }

  private renderSaved(saved: { id: string; name: string }): TemplateResult {
    const t = this.t;
    const editor = editorOf(saved.id);
    return html`<p class="line ok" data-testid="plain-saved">
        ${icon(mdiCheckCircleOutline)}${t.t("plain.saved", { name: saved.name })}
      </p>
      <div class="footer">
        <a
          class="open"
          href=${editor}
          data-testid="plain-open-editor"
          @click=${(event: MouseEvent) => {
            this.openEditor(event, editor);
          }}
          >${icon(mdiOpenInNew)}${t.t("plain.open_editor")}</a
        >
        <button
          class="action"
          data-autofocus
          data-testid="plain-another"
          @click=${() => {
            this.startOver();
          }}
        >
          ${t.t("plain.another")}
        </button>
      </div>`;
  }
}

/** What the AI task answered, to read as it is. */
function rawText(data: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return "";
  }
}

define("domotwin-plain", DomoTwinPlain);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-plain": DomoTwinPlain;
  }
}
