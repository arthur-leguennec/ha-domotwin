/**
 * The demo house's configuration history (D-059): a few changes of its automations, a script
 * removed and its dashboard, answered as the integration would; a version put back in the page.
 */
import type { ConfigDetail, ConfigKind, ConfigList, ConfigVersion } from "../live/config-history";
import { canonical } from "../live/config-history";
import { DemoError } from "./home";
import { AUTOMATIONS, say, type Words } from "./house";

const DAY_MS = 86_400_000;

interface Kept {
  id: number;
  at: number;
  /** null: removed. */
  config: Record<string, unknown> | null;
}

interface DemoItem {
  kind: ConfigKind;
  key: string;
  names: Words;
  versions: Kept[];
}

/** An automation of the demo house: its id in the editor's file, its names, its configuration. */
function automation(id: string): { key: string; names: Words; config: Record<string, unknown> } {
  const found = AUTOMATIONS.find((each) => each.id === id);
  if (!found) throw new Error(id);
  return { key: id.slice(11), names: found.names, config: found.config };
}

export class DemoConfigHistory {
  private readonly items: DemoItem[];
  private next = 1;

  /** Kept on days before `now` (ms), in `language`. */
  constructor(
    now: number,
    private readonly language: string,
    private readonly clock: () => number,
  ) {
    const evening = automation("automation.evening_lights");
    const curtains = automation("automation.morning_curtains");
    const named = (
      names: Words,
      config: Record<string, unknown>,
      id: string,
    ): Record<string, unknown> => ({
      id,
      alias: say(names, language),
      ...structuredClone(config),
    });
    const eveningNow = named(evening.names, evening.config, evening.key);
    const actions = eveningNow.actions as unknown[];
    const curtainsNow = named(curtains.names, curtains.config, curtains.key);
    const triggers = curtainsNow.triggers as Record<string, unknown>[];
    const goodNight = {
      alias: say(["Good night", "Bonne nuit"], language),
      sequence: [
        { action: "light.turn_off", target: { entity_id: "all" } },
        { action: "lock.lock", target: { entity_id: "lock.front_door" } },
      ],
      mode: "single",
    };
    const kitchen = say(["Kitchen", "Cuisine"], language);
    const card = { type: "tile", entity: "light.living_floor_lamp" };
    const days = (n: number, hour = 0): number => now - n * DAY_MS + hour * 3_600_000;
    this.items = [
      {
        kind: "automation",
        key: evening.key,
        names: evening.names,
        versions: [
          this.kept(days(9, 2), {
            ...eveningNow,
            triggers: [{ trigger: "sun", event: "sunset", offset: "-00:30:00" }],
            actions: actions.slice(0, 1),
          }),
          this.kept(days(3, 1), {
            ...eveningNow,
            triggers: [{ trigger: "sun", event: "sunset", offset: "-00:30:00" }],
          }),
          this.kept(days(1, 3), eveningNow),
        ],
      },
      {
        kind: "automation",
        key: curtains.key,
        names: curtains.names,
        versions: [
          this.kept(days(6), { ...curtainsNow, triggers: [{ ...triggers[0], at: "07:00:00" }] }),
          this.kept(days(2, 4), curtainsNow),
        ],
      },
      {
        kind: "script",
        key: "good_night",
        names: ["Good night", "Bonne nuit"],
        versions: [this.kept(days(5, 1), goodNight), this.kept(days(2, 2), null)],
      },
      {
        kind: "dashboard",
        key: "",
        names: ["Home", "Maison"],
        versions: [
          this.kept(days(8), {
            title: say(["Home", "Maison"], language),
            views: [{ title: kitchen, cards: [] }],
          }),
          this.kept(days(4, 2), {
            title: say(["Home", "Maison"], language),
            views: [{ title: kitchen, cards: [card] }],
          }),
        ],
      },
    ];
  }

  private kept(at: number, config: Record<string, unknown> | null): Kept {
    return { id: this.next++, at, config };
  }

  private find(id: unknown): DemoItem {
    const item = this.items.find((each) => `${each.kind}:${each.key}` === id);
    if (!item) throw new DemoError("unknown_item");
    return item;
  }

  private summary(item: DemoItem): ConfigList["items"][number] {
    const newest = item.versions.at(-1) as Kept;
    return {
      id: `${item.kind}:${item.key}`,
      kind: item.kind,
      key: item.key,
      name: say(item.names, this.language),
      source: "editor",
      removed: newest.config === null,
      versions: item.versions.length,
      changed: new Date(newest.at).toISOString(),
    };
  }

  list(): ConfigList {
    // The most recently changed first.
    const items = [...this.items].sort(
      (a, b) => (b.versions.at(-1)?.at ?? 0) - (a.versions.at(-1)?.at ?? 0),
    );
    const bytes = this.items
      .flatMap((item) => item.versions)
      .reduce((sum, kept) => sum + (kept.config ? JSON.stringify(kept.config).length : 0), 0);
    return { items: items.map((item) => this.summary(item)), bytes, max_bytes: 4_000_000 };
  }

  item(id: unknown): ConfigDetail {
    const item = this.find(id);
    const seen = new Map<string, number>();
    const versions: ConfigVersion[] = item.versions.map((kept) => {
      const version: ConfigVersion = {
        id: kept.id,
        at: new Date(kept.at).toISOString(),
        removed: kept.config === null,
        kept: kept.config !== null,
      };
      if (kept.config) {
        const key = canonical(kept.config);
        const same = seen.get(key);
        if (same !== undefined) version.same_as = same;
        seen.set(key, kept.id);
      }
      return version;
    });
    return { item: this.summary(item), versions: versions.reverse() };
  }

  version(id: unknown, version: unknown): unknown {
    const kept = this.find(id).versions.find((each) => each.id === version);
    if (!kept) throw new DemoError("unknown_version");
    return structuredClone(kept.config);
  }

  /** A configuration put back, as Home Assistant's editors would save it: its newest version. */
  putBack(kind: ConfigKind, key: string, config: unknown): void {
    const item = this.find(`${kind}:${key}`);
    const newest = item.versions.at(-1);
    const copy = structuredClone(config) as Record<string, unknown>;
    if (newest?.config && canonical(newest.config) === canonical(copy)) return;
    item.versions.push(this.kept(this.clock(), copy));
  }
}
