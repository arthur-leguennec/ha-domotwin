/**
 * The sites one Home Assistant runs (`docs/DECISIONS.md`, D-090): buildings or shops of their
 * own, each a group of the home's storeys, its own opening hours if it has some. The site shown is
 * the shown storey's; this device remembers the last one, to open on it.
 */
import type { Settings, Site, StoreyInfo } from "../ha/client";
import type { HomeAssistant } from "../ha/types";
import { roomArea, type BindingsJson } from "./bindings";
import type { PlanRoom } from "./layers";
import type { OnSite } from "./people";
import { closedEntities } from "./privacy";
import { storeyLevels, type StoreyRooms } from "./storeys";

/** As many sites as the integration keeps (`MAX_SITES`). */
export const MAX_SITES = 16;

/** Where this device keeps the site it was last on. */
const DEVICE_KEY = "domotwin-site";

/**
 * The home's sites, each with the storeys that are still the home's; a storey in none is the
 * first's, one in two the first's of them. None when there are fewer than two: then everything
 * is the home's, as before sites.
 */
export function homeSites(
  settings: Pick<Settings, "sites"> | undefined,
  storeys: readonly Pick<StoreyInfo, "id">[],
): Site[] {
  const listed = settings?.sites ?? [];
  if (listed.length < 2) return [];
  const known = new Set(storeys.map((storey) => storey.id));
  const placed = new Set<string>();
  const sites = listed.map((site) => {
    const own = site.storeys.filter((id) => known.has(id) && !placed.has(id));
    for (const id of own) placed.add(id);
    return { ...site, storeys: own };
  });
  const first = sites[0];
  if (first) {
    first.storeys = [
      ...first.storeys,
      ...storeys.map((storey) => storey.id).filter((id) => !placed.has(id)),
    ];
  }
  return sites;
}

/** The site of a storey (the first for none, or one it does not know); none without sites. */
export function siteOf(sites: readonly Site[], storey: string | undefined): Site | undefined {
  return (storey && sites.find((site) => site.storeys.includes(storey))) || sites[0];
}

/** The storeys of a site, as the home lists them; all of them without sites. */
export function siteStoreys<T extends Pick<StoreyInfo, "id">>(
  storeys: readonly T[],
  site: Site | undefined,
): T[] {
  return site ? storeys.filter((storey) => site.storeys.includes(storey.id)) : [...storeys];
}

/** A site's ground floor: of its storeys, the one nearest the ground (D-026). */
export function siteGround(
  storeys: readonly StoreyInfo[],
  site: Site | undefined,
): StoreyInfo | undefined {
  return storeyLevels(siteStoreys(storeys, site)).find((each) => each.level === 0)?.storey;
}

/** The opening hours of a site: its own, else the workplace's. */
export function siteHours(
  settings: Pick<Settings, "workplace"> | undefined,
  site: Site | undefined,
): string | undefined {
  return site?.hours ?? settings?.workplace?.hours;
}

/** What the Home and Rooms tabs show of one site (D-090), and what they leave to the others. */
export interface SiteScope {
  /** Its rooms. */
  rooms: PlanRoom[];
  /** The other sites' rooms' areas (not one of its own), and the entities linked to them. */
  areas: Set<string>;
  entities: Set<string>;
  /** Whether someone on a storey is on it: on none, on the first site. */
  onSite: OnSite;
}

/**
 * What one site shows of the home (D-090): its rooms, and what is the other sites' (their rooms'
 * areas, the entities linked to their rooms and pieces). What is in no site's room (an area no
 * room has, an entity in no area) shows on every site.
 */
export function siteScope(
  hass: HomeAssistant,
  bindings: BindingsJson,
  sites: readonly Site[],
  site: Site,
  storeys: readonly StoreyRooms[],
): SiteScope {
  const own = new Set(site.storeys);
  const here = storeys.filter((storey) => own.has(storey.storey));
  const there = storeys.filter((storey) => !own.has(storey.storey));
  const rooms = here.flatMap((storey) => storey.rooms);
  const areaOf = (room: PlanRoom): string | undefined =>
    roomArea(hass, bindings, room.id, room.name);
  const mine = new Set(rooms.map(areaOf).filter((area): area is string => area !== undefined));
  const others = there.flatMap((storey) => storey.rooms);
  const areas = new Set(
    others.map(areaOf).filter((area): area is string => area !== undefined && !mine.has(area)),
  );
  const entities = closedEntities(bindings, there, new Set(others.map((room) => room.id)));
  const first = sites[0]?.id === site.id;
  return {
    rooms,
    areas,
    entities,
    onSite: (storey) => (storey ? own.has(storey) : first),
  };
}

/** The site this device was last on, if it remembers one. */
export function readDeviceSite(): string | undefined {
  try {
    return window.localStorage.getItem(DEVICE_KEY) ?? undefined;
  } catch {
    // Storage disabled (private browsing, policies).
    return undefined;
  }
}

/** Remembers the site this device is on. */
export function writeDeviceSite(site: string): void {
  try {
    window.localStorage.setItem(DEVICE_KEY, site);
  } catch {
    // Kept for this visit only.
  }
}
