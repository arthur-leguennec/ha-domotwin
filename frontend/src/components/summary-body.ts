/**
 * What a summary card shows (`docs/DECISIONS.md`, D-061), loaded with the first one on the page:
 * its icon, its title and what it says on one line; a tap opens DomoTwin's 3D view on what it sums
 * up. The network's reads the mesh (ZHA, with the analysis module) every few minutes.
 */
import {
  mdiAccountGroupOutline,
  mdiRobotVacuum,
  mdiRobotOutline,
  mdiWrenchClock,
  mdiZigbee,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { DomoTwinClient } from "../ha/client";
import { nowOf, type HomeAssistant } from "../ha/types";
import { languageOf, Translator, type MessageKey } from "../i18n";
import "../i18n/summary";
import { navigate } from "../live/actions";
import { networkAvailable } from "../live/layers";
import { summaryPath, type SummaryKind } from "../live/overview";
import { peopleShown, type PeopleSettings } from "../live/people";
import { automationsSummary, peopleSummary, robotsSummary, upkeepSummary } from "../live/summaries";
import { define } from "./define";
import { icon } from "./icon";

const ICONS: Record<SummaryKind, string> = {
  people: mdiAccountGroupOutline,
  network: mdiZigbee,
  automations: mdiRobotOutline,
  upkeep: mdiWrenchClock,
  robots: mdiRobotVacuum,
};

/** Each summary's colour, as the Overview gives its own. */
const COLORS: Record<SummaryKind, string> = {
  people: "var(--green-color, #4caf50)",
  network: "var(--purple-color, #926bc7)",
  automations: "var(--blue-color, #2196f3)",
  upkeep: "var(--orange-color, #ff9800)",
  robots: "var(--teal-color, #009688)",
};

/** The robots' states said, the others counted together. */
const ROBOT_STATES = ["cleaning", "returning", "paused", "error", "docked", "idle"] as const;

/** How often the network is read again while the card shows (ms). */
const NETWORK_EVERY = 10 * 60_000;

/** What a summary shows: its title and line, and whether a tap opens the panel. */
interface Shown {
  t: Translator;
  title: string;
  line: string;
  opens: boolean;
  key: string;
}

/** What the network summary read: nothing yet, a failure, or the mesh's counts. */
type NetworkRead =
  | { state: "reading" }
  | { state: "failed" }
  | { state: "read"; devices: number; weak: number; stale: number };

export class DomoTwinSummaryBody extends LitElement {
  static override properties = {
    hass: { attribute: false },
    kind: { attribute: false },
    network: { state: true },
    people: { state: true },
  };

  hass?: HomeAssistant;
  kind?: SummaryKind;
  protected network?: NetworkRead;
  /** The people's settings (D-034): who may be named, to this viewer. */
  protected people?: PeopleSettings;
  private networkTimer?: ReturnType<typeof setTimeout>;
  /** When the network was read last (ms), so that a card shown again does not read it sooner. */
  private networkReadAt = -Infinity;
  /** The network asked for last, only its answer kept. */
  private reads = 0;
  /** The people's settings asked for last, only its answer kept. */
  private peopleReads = 0;
  private unsubscribe?: () => void;
  /** What is drawn (its language, whether it opens the panel, its line), and what is to be. */
  private drawn?: string;
  private next?: Shown;
  private translator?: Translator;

  static override styles = css`
    :host {
      display: block;
    }
    ha-card {
      height: 100%;
      box-sizing: border-box;
    }
    button,
    .row {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      height: 100%;
      padding: 10px 12px;
      border-radius: var(--ha-card-border-radius, 12px);
      color: var(--primary-text-color);
    }
    button {
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -2px;
    }
    .icon {
      flex: none;
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: var(--summary-color);
      background: color-mix(in srgb, var(--summary-color) 20%, transparent);
    }
    .icon svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    .text {
      min-width: 0;
      display: grid;
      gap: 2px;
    }
    .title {
      font-weight: 500;
      font-size: 0.95rem;
    }
    .state {
      color: var(--secondary-text-color);
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // Put back on the page (the first time, `willUpdate` starts them).
    if (this.hasUpdated) this.follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.networkTimer);
    this.networkTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("kind") || (changed.has("hass") && !changed.get("hass"))) this.follow();
    // ZHA set up, or the user an administrator, since: the mesh is read from now on.
    else if (this.kind === "network" && !this.networkTimer && networkAvailable(this.hass)) {
      this.followNetwork();
    }
  }

  /**
   * Drawn again when what it shows changes, not at every state of the home: what it says is worked
   * out (a few passes over the states, as a card of Home Assistant's does) and compared.
   */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size !== 1 || !changed.has("hass") || !changed.get("hass")) return true;
    this.next = this.shown();
    return this.next?.key !== this.drawn;
  }

  /** What it shows now. */
  private shown(): Shown | undefined {
    const hass = this.hass;
    const kind = this.kind;
    if (!hass || !kind) return undefined;
    const language = languageOf(hass);
    if (this.translator?.language !== language) this.translator = new Translator(language);
    const t = this.translator;
    const title = t.t(`summary.titles.${kind}` as MessageKey);
    const line = this.said(kind, hass, t);
    // The panel this user has: none when it is left out of the sidebar, or for administrators
    // only (Home Assistant lists only the panels a user may open).
    const opens = hass.panels === undefined || hass.panels.domotwin !== undefined;
    return { t, title, line, opens, key: `${language}\u0000${String(opens)}\u0000${line}` };
  }

  /** What each summary follows besides the states: the mesh, or the people's settings. */
  private follow(): void {
    this.followNetwork();
    this.followPeople();
  }

  /** The people's settings, read now and again when they are saved. */
  private followPeople(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const hass = this.hass;
    if (!this.isConnected || this.kind !== "people" || !hass) return;
    const client = DomoTwinClient.for(hass);
    const read = (): void => {
      const asked = ++this.peopleReads;
      client.getPeople().then(
        (people) => {
          if (asked === this.peopleReads) this.people = people;
        },
        // An integration that cannot say (older, or not set up): the rooms are not named.
        () => undefined,
      );
    };
    this.unsubscribe = client.subscribe((event) => {
      if (event.kind === "people") read();
    });
    read();
  }

  /**
   * The network summary reads the mesh every few minutes, the first time at once; a card shown
   * again (another view of the dashboard) waits for its turn. The others need not.
   */
  private followNetwork(): void {
    clearTimeout(this.networkTimer);
    this.networkTimer = undefined;
    if (!this.isConnected || this.kind !== "network") return;
    if (!networkAvailable(this.hass)) return;
    const next = (wait: number): void => {
      this.networkTimer = setTimeout(() => {
        void this.readNetwork();
        next(NETWORK_EVERY);
      }, wait);
    };
    next(Math.max(0, this.networkReadAt + NETWORK_EVERY - Date.now()));
  }

  private async readNetwork(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    const read = ++this.reads;
    this.networkReadAt = Date.now();
    this.network ??= { state: "reading" };
    try {
      const [{ zhaSource, snapshot }, { analyseNetwork }] = await Promise.all([
        import("../live/network"),
        import("../analysis/analysis"),
      ]);
      const devices = await zhaSource(hass).devices();
      // No room is asked of the analysis here: the links' quality is all the summary says.
      const text = await analyseNetwork(
        snapshot(devices, new Map()),
        () => read === this.reads,
        () => "[]",
      );
      if (text === undefined || read !== this.reads) return;
      const analysis = JSON.parse(text) as {
        health?: { weakLinks?: number; stale?: unknown[] };
      };
      this.network = {
        state: "read",
        devices: devices.length,
        weak: analysis.health?.weakLinks ?? 0,
        stale: analysis.health?.stale?.length ?? 0,
      };
    } catch {
      if (read === this.reads) this.network = { state: "failed" };
    }
  }

  /** What the summary says, on one line. */
  private said(kind: SummaryKind, hass: HomeAssistant, t: Translator): string {
    switch (kind) {
      case "people": {
        const shown = this.people
          ? new Set(peopleShown(this.people, hass).map((person) => person.id))
          : undefined;
        const { home, rooms } = peopleSummary(hass, shown);
        if (home === 0) return t.t("summary.people.nobody");
        const parts = [t.tp("summary.people.home", home)];
        if (rooms.length > 0) parts.push(t.t("summary.people.in", { rooms: rooms.join(", ") }));
        return parts.join(" · ");
      }
      case "network": {
        if (!(hass.config?.components ?? []).includes("zha")) return t.t("summary.network.none");
        if (!networkAvailable(hass)) return t.t("summary.network.admins");
        const read = this.network;
        if (!read || read.state === "reading") return t.t("summary.network.reading");
        if (read.state === "failed") return t.t("summary.network.unreadable");
        const parts = [t.tp("summary.network.devices", read.devices)];
        if (read.weak > 0) parts.push(t.tp("summary.network.weak", read.weak));
        if (read.stale > 0) parts.push(t.tp("summary.network.stale", read.stale));
        if (read.weak === 0 && read.stale === 0) parts.push(t.t("summary.network.fine"));
        return parts.join(" · ");
      }
      case "automations": {
        const { total, on, today } = automationsSummary(hass, nowOf(hass));
        if (total === 0) return t.t("summary.automations.none");
        return [
          t.tp("summary.automations.on", on, { total }),
          t.tp("summary.automations.today", today),
        ].join(" · ");
      }
      case "upkeep": {
        const upkeep = upkeepSummary(hass);
        if (!upkeep) return t.t("summary.upkeep.none");
        if (upkeep === "unavailable") return t.t("summary.upkeep.unavailable");
        if (upkeep.due === 0) return t.t("summary.upkeep.nothing");
        const parts = [t.tp("summary.upkeep.due", upkeep.due)];
        if (upkeep.next) parts.push(t.t("summary.upkeep.next", upkeep.next));
        return parts.join(" · ");
      }
      case "robots": {
        const { total, states } = robotsSummary(hass);
        if (total === 0) return t.t("summary.robots.none");
        const parts: string[] = [];
        let others = total;
        for (const state of ROBOT_STATES) {
          const count = states.get(state) ?? 0;
          if (count === 0) continue;
          others -= count;
          parts.push(t.tp(`summary.robots.states.${state}`, count));
        }
        if (others > 0) parts.push(t.tp("summary.robots.states.other", others));
        return parts.join(" · ");
      }
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const shown = this.next ?? this.shown();
    this.next = undefined;
    const kind = this.kind;
    if (!shown || !kind) return nothing;
    this.drawn = shown.key;
    const { t, title, line, opens } = shown;
    const inside = html`<span class="icon" aria-hidden="true">${icon(ICONS[kind])}</span>
      <span class="text">
        <span class="title">${title}</span>
        <span class="state" data-testid="summary-state">${line}</span>
      </span>`;
    const style = `--summary-color:${COLORS[kind]}`;
    return html`<ha-card>
      ${
        opens
          ? html`<button
              style=${style}
              aria-label=${t.t("summary.open", { title })}
              data-testid=${`summary-${kind}`}
              @click=${() => {
                navigate(summaryPath(kind));
              }}
            >
              ${inside}
            </button>`
          : html`<div class="row" style=${style} data-testid=${`summary-${kind}`}>${inside}</div>`
      }
    </ha-card>`;
  }
}

define("domotwin-summary-body", DomoTwinSummaryBody);
