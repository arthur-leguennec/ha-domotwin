/**
 * Home Assistant's media, for a wall screen's photos (`docs/DECISIONS.md`, D-076): a folder's
 * folders and photos, and a photo's address, signed by Home Assistant for a while. Read through
 * Home Assistant's own `media_source` commands; nothing leaves Home Assistant. Loaded with the
 * screen saver and the wall screens' dialog only.
 */
import type { HassMessage, HomeAssistant } from "../ha/types";

/** A photo of a media folder: its id, to ask Home Assistant for its address when shown. */
export interface MediaItem {
  id: string;
  title: string;
}

/** A folder of Home Assistant's media, as `media_source/browse_media` answers it. */
export interface MediaFolder {
  title: string;
  /** Its folders, to open. */
  folders: MediaItem[];
  /** Its photos. */
  photos: MediaItem[];
}

/** At most this many photos are taken from a folder (their ids only: cheap to keep). */
export const MAX_PHOTOS = 10_000;

/** A folder Home Assistant answered, read: its folders and its photos, what is neither left out. */
export function readMediaFolder(raw: unknown): MediaFolder {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const children = Array.isArray(value.children) ? (value.children as unknown[]) : [];
  const folders: MediaItem[] = [];
  const photos: MediaItem[] = [];
  for (const child of children) {
    if (typeof child !== "object" || child === null) continue;
    const item = child as Record<string, unknown>;
    const id = item.media_content_id;
    if (typeof id !== "string" || !id.startsWith("media-source://")) continue;
    const title = typeof item.title === "string" ? item.title : id;
    const type = typeof item.media_content_type === "string" ? item.media_content_type : "";
    if (item.can_expand === true) folders.push({ id, title });
    else if (item.media_class === "image" || type.startsWith("image/")) {
      if (photos.length < MAX_PHOTOS) photos.push({ id, title });
    }
  }
  return {
    title: typeof value.title === "string" ? value.title : "",
    folders,
    photos,
  };
}

/** A folder of Home Assistant's media (`id`), else its sources: its folders and its photos. */
export async function browseMedia(hass: HomeAssistant, id?: string): Promise<MediaFolder> {
  const message: HassMessage = { type: "media_source/browse_media" };
  if (id) message.media_content_id = id;
  return readMediaFolder(await hass.connection.sendMessagePromise(message));
}

/** The address of a photo of Home Assistant's media, signed for `expires` seconds. */
export async function resolveMedia(
  hass: HomeAssistant,
  id: string,
  expires = 3600,
): Promise<string> {
  const result = await hass.connection.sendMessagePromise<{ url?: unknown }>({
    type: "media_source/resolve_media",
    media_content_id: id,
    expires,
  });
  if (typeof result.url !== "string") throw new Error("no address");
  return hass.hassUrl ? hass.hassUrl(result.url) : result.url;
}

/** The photos in another order each time (`random` from 0 to 1). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}
