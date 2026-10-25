/**
 * The plan editor's module (`docs/DECISIONS.md`, D-025), loaded the first time the plan editor
 * opens: the draft of the plan, in plan centimetres, with undo and redo. A change the plan reader
 * refuses throws an `EngineError` with the reader's code and leaves the draft as it was.
 */
import { wasmLoader } from "../assets";
import { engineError } from "../engine/engine";
import type * as Wasm from "./pkg/domotwin_planner.js";

const loadPlannerWasm = wasmLoader(
  () => import("./pkg/domotwin_planner.js"),
  __DOMOTWIN_PLANNER_WASM__,
);

function checked<T>(change: () => T): T {
  try {
    return change();
  } catch (error) {
    throw engineError(error);
  }
}

/**
 * `plan` with ids none of `taken` has (`<id>-2`…), for a storey joining a home whose other
 * storeys use some of them; the `room` of its elements follows.
 */
export async function freeIds(
  plan: Record<string, unknown>,
  taken: string[],
): Promise<Record<string, unknown>> {
  const wasm = await loadPlannerWasm();
  return JSON.parse(checked(() => wasm.freeIds(JSON.stringify(plan), taken))) as Record<
    string,
    unknown
  >;
}

/** A plan point (cm). */
export type PlanPoint = [number, number];

/** A line a point was lined up on (plan cm). */
export interface PlanGuide {
  a: PlanPoint;
  b: PlanPoint;
}

/** A plan being edited. */
export class Planner {
  private constructor(private draft: Wasm.Planner | undefined) {}

  /**
   * Starts editing `plan` (its edit overlay applied); without one, a new plan titled `title`
   * holding one room named `room`. New elements take none of the ids `reserved` (those with
   * links).
   */
  static async open(
    plan: Record<string, unknown> | null,
    title: string,
    room: string,
    reserved: string[],
  ): Promise<Planner> {
    const wasm = await loadPlannerWasm();
    if (!plan) return new Planner(wasm.Planner.blank(title, room, reserved));
    const planner = new Planner(checked(() => new wasm.Planner(JSON.stringify(plan))));
    planner.reserve(reserved);
    return planner;
  }

  private get live(): Wasm.Planner {
    if (!this.draft) throw new Error("the planner was disposed");
    return this.draft;
  }

  /** Ids new elements must not take (those whose links are still stored). */
  reserve(ids: string[]): void {
    this.live.reserve(ids);
  }

  /** The draft as JSON text (what Save stores). */
  get text(): string {
    return this.live.plan();
  }

  get dirty(): boolean {
    return this.live.dirty();
  }

  get canUndo(): boolean {
    return this.live.canUndo();
  }

  get canRedo(): boolean {
    return this.live.canRedo();
  }

  markSaved(): void {
    this.live.markSaved();
  }

  undo(): boolean {
    return this.live.undo();
  }

  redo(): boolean {
    return this.live.redo();
  }

  beginDrag(): void {
    this.live.beginDrag();
  }

  endDrag(): void {
    this.live.endDrag();
  }

  /** Element `id` with its fields, or undefined. */
  element(id: string): Record<string, unknown> | undefined {
    const text = this.live.element(id);
    return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  }

  /** The corners of room `id` (empty for anything else). */
  roomPoints(id: string): PlanPoint[] {
    const flat = this.live.roomPoints(id);
    const points: PlanPoint[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i] ?? 0, flat[i + 1] ?? 0]);
    return points;
  }

  /**
   * The point element `id` is held by when dragged: a room's first corner, else the first end
   * (`from`) of a partition, a door or a window; undefined for anything else.
   */
  anchor(id: string): PlanPoint | undefined {
    const corner = this.roomPoints(id)[0];
    if (corner) return corner;
    const from = this.element(id)?.from;
    if (!Array.isArray(from)) return undefined;
    const [x, y] = from as unknown[];
    return typeof x === "number" && typeof y === "number" ? [x, y] : undefined;
  }

  /** Where a point goes, snapped, and the guides it was lined up on. */
  snap(p: PlanPoint, except?: string): { point: PlanPoint; guides: PlanGuide[] } {
    const flat = this.live.snap(p[0], p[1], except);
    const guides: PlanGuide[] = [];
    for (let i = 2; i + 3 < flat.length; i += 4) {
      guides.push({
        a: [flat[i] ?? 0, flat[i + 1] ?? 0],
        b: [flat[i + 2] ?? 0, flat[i + 3] ?? 0],
      });
    }
    return { point: [flat[0] ?? p[0], flat[1] ?? p[1]], guides };
  }

  /** Adds a rectangular room between two corners. Returns its id. */
  addRoom(a: PlanPoint, b: PlanPoint, name: string): string {
    return checked(() => this.live.addRoom(a[0], a[1], b[0], b[1], name));
  }

  /** Adds a partition. Returns its id. */
  addWall(a: PlanPoint, b: PlanPoint, name: string): string {
    return checked(() => this.live.addWall(a[0], a[1], b[0], b[1], name));
  }

  /** Places a door or a window on the nearest side of a room; undefined when none is near. */
  addOpening(door: boolean, p: PlanPoint, name: string): string | undefined {
    return checked(() => this.live.addOpening(door, p[0], p[1], name)) || undefined;
  }

  moveCorner(id: string, corner: number, p: PlanPoint): void {
    checked(() => {
      this.live.moveCorner(id, corner, p[0], p[1]);
    });
  }

  insertCorner(id: string, side: number, p: PlanPoint): void {
    checked(() => {
      this.live.insertCorner(id, side, p[0], p[1]);
    });
  }

  removeCorner(id: string, corner: number): void {
    checked(() => {
      this.live.removeCorner(id, corner);
    });
  }

  moveElement(id: string, d: PlanPoint): void {
    checked(() => {
      this.live.moveElement(id, d[0], d[1]);
    });
  }

  /** Changes fields of element `id` (`name`, `floor`, `w`, `swing`, `style`, `thickness`…). */
  update(id: string, fields: Record<string, unknown>): void {
    checked(() => {
      this.live.update(id, JSON.stringify(fields));
    });
  }

  remove(id: string): void {
    checked(() => {
      this.live.remove(id);
    });
  }

  /** Puts a whole plan in place (a draft kept by the browser), as one change. */
  replace(plan: Record<string, unknown>): void {
    checked(() => {
      this.live.replace(JSON.stringify(plan));
    });
  }

  dispose(): void {
    this.draft?.free();
    this.draft = undefined;
  }
}
