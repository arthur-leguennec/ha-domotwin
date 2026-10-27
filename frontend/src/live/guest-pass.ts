/**
 * A guest pass as an administrator sees it (`docs/DECISIONS.md`, D-067), read from what
 * `domotwin/guests/*` answer. Kept apart from `guests.ts`, with nothing imported, so that the client
 * that reads it adds nothing else to the first picture.
 */

/** Where a pass stands. */
export type PassStatus = "upcoming" | "open" | "ended";

/** A pass as an administrator sees it (`domotwin/guests/get`). */
export interface GuestPass {
  id: string;
  name: string;
  rooms: string[];
  entities: string[];
  /** ISO 8601. */
  starts: string;
  ends: string;
  /** The guests may use the devices (else only look). */
  act: boolean;
  /** The home's Wi-Fi is shown. */
  wifi: boolean;
  /** It opens from anywhere (else only on the home's network). */
  anywhere: boolean;
  /** Its link's path, and its address as Home Assistant knows itself, if it does. */
  path: string;
  url: string | null;
  status: PassStatus;
}

/** A pass made or changed (`domotwin/guests/save`); `renew` gives it a new link. */
export interface GuestPassChange {
  id?: string;
  name: string;
  rooms: string[];
  entities: string[];
  starts: string;
  ends: string;
  act: boolean;
  wifi: boolean;
  anywhere: boolean;
  renew?: boolean;
}

const STATUSES: readonly PassStatus[] = ["upcoming", "open", "ended"];

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Reads `domotwin/guests/get`'s passes; what cannot be read is left out. */
export function readPasses(raw: unknown): GuestPass[] {
  const listed = (raw as { passes?: unknown } | null)?.passes;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((value: unknown) => {
    const pass = readPass(value);
    return pass ? [pass] : [];
  });
}

/** One pass as `domotwin/guests/save` answers it. */
export function readPass(raw: unknown): GuestPass | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  const status = STATUSES.find((s) => s === p.status);
  if (
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    typeof p.starts !== "string" ||
    typeof p.ends !== "string" ||
    typeof p.path !== "string" ||
    !status
  ) {
    return undefined;
  }
  return {
    id: p.id,
    name: p.name,
    rooms: strings(p.rooms),
    entities: strings(p.entities),
    starts: p.starts,
    ends: p.ends,
    act: p.act !== false,
    wifi: p.wifi !== false,
    anywhere: p.anywhere === true,
    path: p.path,
    url: typeof p.url === "string" ? p.url : null,
    status,
  };
}

/** A pass's link: as Home Assistant knows its own address, else from the page's. */
export function passLink(pass: GuestPass, origin: string): string {
  return pass.url ?? `${origin}${pass.path}`;
}
