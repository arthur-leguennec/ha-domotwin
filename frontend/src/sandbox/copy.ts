/**
 * The copy of the home the sandbox plays on (D-057), read once when it opens and never written
 * back: the states and registries as they are, DomoTwin's plan, links and settings, and the
 * configurations of the automations, scripts and scenes, which Home Assistant gives to
 * administrators. Reading is all it asks of Home Assistant.
 */
import type { DemoStore } from "../demo/home";
import { DomoTwinClient, type StoreyInfo } from "../ha/client";
import type {
  HassAreaEntry,
  HassDeviceEntry,
  HassEntity,
  HassEntityEntry,
  HassFloorEntry,
  HomeAssistant,
} from "../ha/types";
import { NO_CHOICES } from "../live/choices";
import { automationConfig } from "../live/automations";
import { NO_UPKEEP } from "../live/upkeep";
import type { PlayedAutomation, PlayedScene, PlayedScript } from "./engine";
import { isRecord } from "./config";
import { pythonText } from "./templates";
import { usableZone } from "./time";

export interface HomeCopy {
  states: Record<string, HassEntity>;
  entities: Record<string, HassEntityEntry>;
  devices: Record<string, HassDeviceEntry>;
  areas: Record<string, HassAreaEntry>;
  floors: Record<string, HassFloorEntry>;
  store: DemoStore;
  automations: PlayedAutomation[];
  scripts: PlayedScript[];
  scenes: PlayedScene[];
  /** Entity registry ids to entity ids (devices' triggers name entities so). */
  registry: Record<string, string>;
  energy?: unknown;
  zone: string;
  latitude?: number;
  longitude?: number;
  /** The home's units, as its Home Assistant says them (°C or °F). */
  units?: { temperature?: string };
}

const kept = <T>(record: Record<string, T | undefined> | undefined): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record ?? {}).filter((entry): entry is [string, T] => entry[1] !== undefined),
  );

/** Reads at most `limit` at once, as answers come. */
async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next;
      next += 1;
      out[at] = await read(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function ask<T>(
  hass: HomeAssistant,
  message: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    return await hass.connection.sendMessagePromise<T>({ type: String(message.type), ...message });
  } catch {
    return undefined;
  }
}

/** A scene's states, as Home Assistant's scene editor keeps them. */
function sceneEntities(config: unknown): PlayedScene["entities"] {
  if (!isRecord(config) || !isRecord(config.entities)) return undefined;
  const entities: NonNullable<PlayedScene["entities"]> = {};
  for (const [id, value] of Object.entries(config.entities)) {
    if (isRecord(value)) {
      const { state, ...attributes } = value;
      entities[id] = { state: pythonText(state), attributes };
    } else if (typeof value === "string") {
      entities[id] = { state: value, attributes: {} };
    }
  }
  return entities;
}

/** Reads the home for the sandbox. */
export async function copyHome(hass: HomeAssistant): Promise<HomeCopy> {
  const states = structuredClone(kept(hass.states));
  const ids = Object.keys(states);
  const of = (domain: string) => ids.filter((id) => id.startsWith(`${domain}.`)).sort();
  const client = DomoTwinClient.for(hass);
  const [stored, bindings, settings, upkeep, people, choices, registry, energy] = await Promise.all(
    [
      client.getPlan(),
      client.getBindings(),
      client.getSettings(),
      client.getUpkeep().catch(() => undefined),
      client.getPeople().catch(() => undefined),
      client.getChoices().catch(() => NO_CHOICES),
      ask<{ id?: unknown; entity_id?: unknown }[]>(hass, { type: "config/entity_registry/list" }),
      ask<unknown>(hass, { type: "energy/get_prefs" }),
    ],
  );
  const storeyList: StoreyInfo[] = stored.storeys.length > 0 ? stored.storeys : [];
  const readStoreys = async () =>
    storeyList.length > 0
      ? await Promise.all(
          storeyList.map(async (info) => {
            const one = info.id === stored.storey ? stored : await client.getPlan(info.id);
            return {
              info: { ...info },
              plan: structuredClone(one.plan ?? {}),
              layout: structuredClone(one.layout),
            };
          }),
        )
      : [
          {
            info: { id: stored.storey ?? "storey-1", name: "", elevation: 0 },
            plan: structuredClone(stored.plan ?? {}),
            layout: structuredClone(stored.layout),
          },
        ];
  // The storeys, automations, scripts and scenes side by side, each a few at a time.
  const readAutomations = () =>
    pooled(of("automation"), 8, async (id): Promise<PlayedAutomation> => {
      const config = await automationConfig(hass, id);
      return isRecord(config) ? { id, config } : { id };
    });
  const readScripts = () =>
    pooled(of("script"), 8, async (id): Promise<PlayedScript> => {
      const answer = await ask<{ config?: unknown }>(hass, {
        type: "script/config",
        entity_id: id,
      });
      return isRecord(answer?.config) ? { id, config: answer.config } : { id };
    });
  const readScenes = () =>
    pooled(of("scene"), 8, async (id): Promise<PlayedScene> => {
      const sceneId = states[id]?.attributes.id;
      if (typeof sceneId !== "string" || !hass.fetchWithAuth) return { id };
      try {
        const response = await hass.fetchWithAuth(
          `/api/config/scene/config/${encodeURIComponent(sceneId)}`,
        );
        if (!response.ok) return { id };
        const entities = sceneEntities(await response.json());
        return entities ? { id, entities } : { id };
      } catch {
        return { id };
      }
    });
  const [storeys, automations, scripts, scenes] = await Promise.all([
    readStoreys(),
    readAutomations(),
    readScripts(),
    readScenes(),
  ]);
  const registryIds: Record<string, string> = {};
  for (const entry of Array.isArray(registry) ? registry : []) {
    if (typeof entry.id === "string" && typeof entry.entity_id === "string") {
      registryIds[entry.id] = entry.entity_id;
    }
  }
  const config = hass.config ?? {};
  return {
    states,
    entities: structuredClone(kept(hass.entities)),
    devices: structuredClone(kept(hass.devices)),
    areas: structuredClone(kept(hass.areas)),
    floors: structuredClone(kept(hass.floors)),
    store: {
      revision: 1,
      storeys,
      bindings: structuredClone(bindings.bindings),
      settings: structuredClone(settings.settings),
      upkeep: structuredClone(upkeep?.upkeep ?? NO_UPKEEP),
      people: structuredClone(
        people ?? { revision: 1, shown: "everyone", look: "figure", hidden: [], people: {} },
      ),
      schedules: [],
      choices: structuredClone(choices),
    } satisfies DemoStore,
    automations,
    scripts,
    scenes,
    registry: registryIds,
    ...(energy !== undefined ? { energy } : {}),
    zone: usableZone(config.time_zone),
    ...(typeof config.latitude === "number" ? { latitude: config.latitude } : {}),
    ...(typeof config.longitude === "number" ? { longitude: config.longitude } : {}),
    ...(config.unit_system ? { units: { ...config.unit_system } } : {}),
  };
}
