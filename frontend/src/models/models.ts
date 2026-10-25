/**
 * The 3D files of user models (DECISIONS.md, D-013 and D-021). Their reader is its own
 * WebAssembly module, fetched only when a plan shows a piece drawn from a 3D file or one is
 * imported. The integration keeps the files under their SHA-256; they are read with the signed-in
 * user's session (`hass.fetchWithAuth`), uploaded by administrators, and embedded in exported
 * plans as `data:` URLs.
 */
import { wasmLoader } from "../assets";
import { EngineError, engineError } from "../engine/engine";
import type { HomeAssistant } from "../ha/types";
import type * as Wasm from "./pkg/domotwin_models.js";

export const MODEL_FORMATS = ["glb", "gltf", "obj", "stl", "3mf"] as const;
export type ModelFormat = (typeof MODEL_FORMATS)[number];

/** Media types of the formats, for `data:` URLs. */
export const MODEL_MEDIA: Record<ModelFormat, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "model/obj",
  stl: "model/stl",
  "3mf": "model/3mf",
};

/** Largest file (bytes). */
export const MAX_MODEL_BYTES = 8_000_000;

/** Units a file's size can be read in, in cm. */
export const UNITS = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 } as const;
export type ModelUnit = keyof typeof UNITS;

/** What a file holds. */
export interface ModelInfo {
  triangles: number;
  /** Size of its box along its own x, y and z, in its unit. */
  size: [number, number, number];
  /** The unit the file declares (`um`, `mm`, `cm`, `m`, `in`, `ft`), or null. */
  unit: string | null;
  /** The axis that usually points up for the format. */
  up: "y" | "z";
  images: number;
  /** It has colours of its own (else it takes the piece's colour). */
  colors: boolean;
}

/** A file read: what it holds and its mesh for the engine. */
export interface ReadModel {
  info: ModelInfo;
  mesh: Uint8Array;
}

const loadModelsWasm = wasmLoader(
  () => import("./pkg/domotwin_models.js"),
  __DOMOTWIN_MODELS_WASM__,
);

/** The format of a file, from its name. */
export function formatOf(name: string): ModelFormat | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return MODEL_FORMATS.find((format) => format === extension);
}

/** Pictures are scaled down to this before their colours are taken at the vertices. */
const PICTURE_SIDE = 256;

/** Decodes a picture with the browser, scaled down; undefined when it cannot. */
async function decodePicture(
  bytes: Uint8Array,
  type: string,
): Promise<{ width: number; height: number; rgba: Uint8Array } | undefined> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
      imageOrientation: "none",
    });
    const scale = Math.min(1, PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas =
      typeof OffscreenCanvas === "undefined"
        ? Object.assign(document.createElement("canvas"), { width, height })
        : new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d") as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    return { width, height, rgba: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length) };
  } catch {
    return undefined;
  }
}

/**
 * Reads a file and makes its mesh (pictures are decoded by the browser and sampled at the
 * vertices). Errors are `EngineError`s with the module's codes (`not_model`, `too_large`…).
 */
export async function readModel(bytes: Uint8Array, format: ModelFormat): Promise<ReadModel> {
  if (bytes.length > MAX_MODEL_BYTES) throw new EngineError("too_large");
  const wasm = await loadModelsWasm();
  let file: Wasm.ModelFile;
  try {
    file = new wasm.ModelFile(bytes, format);
  } catch (error) {
    throw engineError(error);
  }
  try {
    for (let i = 0; i < file.imageCount(); i++) {
      const picture = await decodePicture(file.imageBytes(i), file.imageType(i));
      if (picture) file.setImage(i, picture.width, picture.height, picture.rgba);
    }
    return { info: JSON.parse(file.info()) as ModelInfo, mesh: file.mesh() };
  } finally {
    file.free();
  }
}

/** The path of a kept file. */
export function modelPath(hash: string, format: string): string {
  return `/api/domotwin/models/${hash}.${format}`;
}

function authFetch(hass: HomeAssistant): NonNullable<HomeAssistant["fetchWithAuth"]> {
  const fetchWithAuth = hass.fetchWithAuth?.bind(hass);
  if (!fetchWithAuth) throw new EngineError("model_missing");
  return fetchWithAuth;
}

/** The bytes of a kept file. */
export async function fetchModel(
  hass: HomeAssistant,
  hash: string,
  format: string,
): Promise<Uint8Array> {
  const response = await authFetch(hass)(modelPath(hash, format));
  if (!response.ok) throw new EngineError("model_missing");
  return new Uint8Array(await response.arrayBuffer());
}

const meshes = new Map<string, Promise<Uint8Array>>();

/** The mesh of a kept file: fetched and read once per page, shared by every view. */
export function modelMesh(hass: HomeAssistant, hash: string, format: string): Promise<Uint8Array> {
  let mesh = meshes.get(hash);
  if (!mesh) {
    const known = MODEL_FORMATS.find((f) => f === format);
    mesh = known
      ? fetchModel(hass, hash, known).then(async (bytes) => (await readModel(bytes, known)).mesh)
      : Promise.reject(new EngineError("not_model"));
    meshes.set(hash, mesh);
    mesh.catch(() => meshes.delete(hash));
  }
  return mesh;
}

/** Keeps the mesh of a file read here (an import), so that no view fetches it again. */
export function keepMesh(hash: string, mesh: Uint8Array): void {
  meshes.set(hash, Promise.resolve(mesh));
}

/** Uploads a file (administrators); answers its SHA-256 and size. */
export async function uploadModel(
  hass: HomeAssistant,
  bytes: Uint8Array,
  format: ModelFormat,
): Promise<{ hash: string; bytes: number }> {
  const response = await authFetch(hass)(`/api/domotwin/models?format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes as BodyInit,
  });
  const result = (await response.json().catch(() => ({}))) as {
    hash?: unknown;
    bytes?: unknown;
    code?: unknown;
  };
  if (!response.ok || typeof result.hash !== "string") {
    throw new EngineError(typeof result.code === "string" ? result.code : "upload_failed");
  }
  return {
    hash: result.hash,
    bytes: typeof result.bytes === "number" ? result.bytes : bytes.length,
  };
}

/** A file as a `data:` URL (Export plan). */
export function toDataUrl(bytes: Uint8Array, format: ModelFormat): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${MODEL_MEDIA[format]};base64,${btoa(binary)}`;
}

/** The bytes of a base64 `data:` URL, or undefined. */
export function fromDataUrl(url: string): Uint8Array | undefined {
  const match = /^data:[^,;]*;base64,(.*)$/s.exec(url);
  if (!match?.[1]) return undefined;
  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/** The unit a file's size is most likely in: its own, else a guess from the format and size. */
export function guessUnit(info: ModelInfo, format: ModelFormat): ModelUnit {
  const declared = info.unit === "um" ? undefined : info.unit;
  if (declared && declared in UNITS) return declared as ModelUnit;
  const largest = Math.max(...info.size);
  // STL files come from 3D printing, in millimetres; OBJ files are often in metres.
  if (format === "stl") return "mm";
  if (largest <= 5) return "m";
  return largest <= 300 ? "cm" : "mm";
}

/** Width, depth and height (cm) of a file's box in `unit`, with `up` pointing up. */
export function modelSize(
  info: ModelInfo,
  unit: ModelUnit | "um",
  up: "y" | "z",
): [number, number, number] {
  const factor = unit === "um" ? 0.0001 : UNITS[unit];
  const [x, y, z] = info.size.map((v) => Math.round(v * factor * 10) / 10) as [
    number,
    number,
    number,
  ];
  return up === "y" ? [x, z, y] : [x, y, z];
}

/** Whether a size can be a model's (`plan-format.md`): w, d 1–10 000 cm, h 1–300 cm. */
export function validSize([w, d, h]: [number, number, number]): boolean {
  const within = (v: number, max: number): boolean => Number.isFinite(v) && v >= 1 && v <= max;
  return within(w, 10_000) && within(d, 10_000) && within(h, 300);
}

/** A new model id, `m-<uuid>` (random, also on pages served without HTTPS). */
export function newModelId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `m-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
