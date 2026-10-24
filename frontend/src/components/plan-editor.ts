/**
 * The plan editor in the view (`docs/DECISIONS.md`, D-025): what the pointer does with each tool,
 * and the handles drawn over the plan (the selected room's corners and sides, the guides, the
 * shape being drawn). The draft lives in the plan editor's own module (`Planner`), which checks
 * every change; the engine shows each version of it and turns screen points into plan points.
 */
import { nothing, svg, type TemplateResult } from "lit";

import { EngineError, type DomoTwinEngine } from "../engine/engine";
import type { Translator } from "../i18n";
import type { PlanGuide, PlanPoint, Planner } from "../planner/planner";
import { TAP_SLOP } from "../gestures";
import type { PlanCommand } from "./view";

/** What a press on the plan does: select and move, or draw a room, a partition, a door, a window. */
export type PlanTool = "select" | "room" | "wall" | "door" | "window";
export const PLAN_TOOLS: readonly PlanTool[] = ["select", "room", "wall", "door", "window"];

/** The element selected in the plan editor: its fields as in the plan file. */
export interface PlanSelection {
  id: string;
  type: "room" | "wall" | "door" | "window";
  name?: string;
  [field: string]: unknown;
}

/** A corner of the selected room (device pixels). */
export interface PlanCorner {
  i: number;
  x: number;
  y: number;
}

/** The middle of a side of the selected room (device pixels) and the side's length (cm). */
export interface PlanSide extends PlanCorner {
  cm: number;
}

/** A line drawn while a point snaps (device pixels). */
export interface PlanScreenGuide {
  a: [number, number];
  b: [number, number];
}

/** What the plan editor shows. */
export interface PlanEditState {
  selection: PlanSelection | null;
  /** The selected room's corners shown (all, unless one is out of the camera's reach). */
  corners: PlanCorner[];
  /** How many corners the selected room has. */
  cornerCount: number;
  sides: PlanSide[];
  guides: PlanScreenGuide[];
  /** The corner grabbed last (the one « Remove corner » takes away). */
  corner: number | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Changes not saved (a new plan is one). */
  dirty: boolean;
  /** The code of the last change refused (`errors.plan.<code>`, or `no_side`). */
  error: string | null;
  /** How many changes were refused so far (a new refusal, even of the same code, is said). */
  refusals: number;
  /** No plan is stored yet. */
  empty: boolean;
}

/** A corner is grabbed within this many device pixels of it. */
const CORNER_REACH = 16;
/** A room dropped with a tap is this wide and deep (cm). */
const TAP_ROOM = 300;
/** Sides shorter than this on screen (CSS pixels) show no length. */
const MIN_LABELLED_SIDE = 40;
/**
 * How far a side's length is drawn outside the room (CSS pixels): more beside an upright side, as
 * the text is wider than tall.
 */
const LABEL_OFFSET = 18;
const LABEL_SIDEWAYS = 22;

type Point = { x: number; y: number };

/** What the plan editor needs from the view. */
export interface PlanHost {
  /** The device pixel of a CSS pixel of the view. */
  devicePoint(x: number, y: number): Point;
  /** The editor's state changed (`state`), or only where its handles are drawn. */
  planChanged(state?: PlanEditState): void;
  /** A frame is needed (a drag waits for the next one). */
  redraw(): void;
}

/** Where the length of side AB goes: its middle `mid`, pushed away from the room's centre `c`. */
export function sideLabel(a: Point, b: Point, mid: Point, c: Point): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y };
  const offset = LABEL_OFFSET + Math.abs(n.x) * LABEL_SIDEWAYS;
  return { x: mid.x + n.x * offset, y: mid.y + n.y * offset };
}

const PLAN_TYPES = new Set(["room", "wall", "door", "window"]);

/** A room or a partition being drawn: where it started and where it goes now (snapped, cm). */
interface Drawing {
  pointer: number;
  from: Point;
  start: PlanPoint;
  end: PlanPoint;
  guides: PlanGuide[];
  moved: boolean;
}

/** A corner or the selection held: where it was pressed, and whether it has moved. */
type Drag = { pointer: number; from: Point; moved: boolean } & (
  | { kind: "corner"; room: string; corner: number }
  | { kind: "element"; id: string; room: boolean; grab: PlanPoint; anchor: PlanPoint }
);

export class PlanEditor {
  tool: PlanTool = "select";
  state: PlanEditState;
  private selection: string | null = null;
  private corner: number | null = null;
  private guides: PlanGuide[] = [];
  private error: string | null = null;
  private refusals = 0;
  private drawing?: Drawing;
  private drag?: Drag;
  /** Where the held corner or selection goes at the next frame (device pixels). */
  private pending?: Point;
  /** Where the handles were last drawn, to draw them again only when they move. */
  private placed = "";

  constructor(
    private readonly engine: DomoTwinEngine,
    private readonly planner: Planner,
    private readonly host: PlanHost,
    private readonly t: Translator,
    private readonly empty: boolean,
  ) {
    this.state = this.build();
  }

  /** The draft, the overlay in it: what Save stores (with an empty overlay). */
  get plan(): Record<string, unknown> {
    return JSON.parse(this.planner.text) as Record<string, unknown>;
  }

  /** Shows the draft, the selection marked. */
  show(): void {
    this.engine.showDraft(this.planner.text, this.selection ?? "");
  }

  /** The state again, told to the view. */
  private refresh(): void {
    this.state = this.build();
    this.host.planChanged(this.state);
  }

  /**
   * Runs a change of the draft and shows it; a change refused is forgotten and its code kept
   * (`quiet`: not kept, for the moves of a drag, which only stop there).
   */
  private run(change: () => void, quiet = false): boolean {
    try {
      change();
      this.error = null;
      this.show();
      return true;
    } catch (error) {
      if (!quiet) {
        this.error = error instanceof EngineError ? error.code : "unknown";
        this.refusals += 1;
      }
      return false;
    } finally {
      this.refresh();
    }
  }

  private select(id: string | null): void {
    if (id !== this.selection) this.corner = null;
    this.selection = id;
  }

  /** The editor's state: the selection and its handles where the camera draws them now. */
  private build(): PlanEditState {
    const planner = this.planner;
    const element = this.selection ? planner.element(this.selection) : undefined;
    const selection =
      element && PLAN_TYPES.has(String(element.type)) ? (element as PlanSelection) : null;
    const points = selection?.type === "room" ? planner.roomPoints(selection.id) : [];
    const n = points.length;
    const flat: number[] = [];
    for (const p of points) flat.push(p[0], p[1]);
    points.forEach((p, i) => {
      const q = points[(i + 1) % n] ?? p;
      flat.push((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    });
    for (const g of this.guides) flat.push(g.a[0], g.a[1], g.b[0], g.b[1]);
    const screen = flat.length > 0 ? this.engine.screenPoints(flat) : new Float64Array();
    const at = (k: number): [number, number] => [screen[2 * k] ?? NaN, screen[2 * k + 1] ?? NaN];
    const shown = ([x, y]: [number, number]): boolean => Number.isFinite(x) && Number.isFinite(y);
    const round = (v: number): number => Math.round(v * 10) / 10;
    const corners: PlanCorner[] = [];
    const sides: PlanSide[] = [];
    points.forEach((p, i) => {
      const corner = at(i);
      if (shown(corner)) corners.push({ i, x: corner[0], y: corner[1] });
      const middle = at(n + i);
      const q = points[(i + 1) % n] ?? p;
      if (shown(middle)) {
        sides.push({
          i,
          x: middle[0],
          y: middle[1],
          cm: round(Math.hypot(q[0] - p[0], q[1] - p[1])),
        });
      }
    });
    const guides: PlanScreenGuide[] = [];
    this.guides.forEach((_, k) => {
      const a = at(2 * n + 2 * k);
      const b = at(2 * n + 2 * k + 1);
      if (shown(a) && shown(b)) guides.push({ a, b });
    });
    this.placed = screen.join(",");
    return {
      selection,
      corners,
      sides,
      guides,
      cornerCount: n,
      corner: selection?.type === "room" ? this.corner : null,
      canUndo: planner.canUndo,
      canRedo: planner.canRedo,
      dirty: planner.dirty,
      error: this.error,
      refusals: this.refusals,
      empty: this.empty,
    };
  }

  /** The camera moved: the handles follow (drawn again only when they moved). */
  reproject(): void {
    const before = this.placed;
    const state = this.build();
    if (this.placed === before) return;
    this.state = state;
    this.host.planChanged();
  }

  /** The plan point under a CSS pixel of the view, if the floor is there. */
  private planAt(x: number, y: number): PlanPoint | undefined {
    const p = this.host.devicePoint(x, y);
    return this.engine.planPoint(p.x, p.y);
  }

  /** The name of a new element of a tool. */
  private nameOf(tool: "room" | "wall" | "door" | "window"): string {
    return this.t.t(`plan.new_${tool}`);
  }

  /** A press: grabs a corner or the selection, or starts drawing. False: the camera's. */
  down(event: PointerEvent): boolean {
    if (event.button !== 0 || this.drag || this.drawing) return false;
    const from = { x: event.offsetX, y: event.offsetY };
    if (this.tool === "select") return this.grab(event.pointerId, from);
    if (this.tool === "room" || this.tool === "wall") {
      const p = this.planAt(from.x, from.y);
      if (!p) return false;
      const { point, guides } = this.planner.snap(p);
      this.drawing = {
        pointer: event.pointerId,
        from,
        start: point,
        end: point,
        guides,
        moved: false,
      };
      this.host.planChanged();
      return true;
    }
    return false;
  }

  /** Grabs a corner of the selected room near the press, else the selection under it. */
  private grab(pointer: number, from: Point): boolean {
    const id = this.selection;
    if (!id) return false;
    const p = this.host.devicePoint(from.x, from.y);
    let nearest: PlanCorner | undefined;
    let best = CORNER_REACH;
    for (const corner of this.state.corners) {
      const d = Math.hypot(corner.x - p.x, corner.y - p.y);
      if (d <= best) {
        best = d;
        nearest = corner;
      }
    }
    if (nearest) {
      this.drag = { pointer, from, moved: false, kind: "corner", room: id, corner: nearest.i };
      this.corner = nearest.i;
      this.planner.beginDrag();
      this.refresh();
      return true;
    }
    // The selection itself, or a piece of furniture in the selected room.
    const picked = this.engine.pick(p.x, p.y);
    const on = picked?.id === id || (picked?.type === "furniture" && picked.room === id);
    const grab = this.engine.planPoint(p.x, p.y);
    if (!on || !grab) return false;
    const anchor = this.planner.anchor(id);
    if (!anchor) return false;
    this.drag = {
      pointer,
      from,
      moved: false,
      kind: "element",
      id,
      room: this.planner.roomPoints(id).length > 0,
      grab,
      anchor,
    };
    this.planner.beginDrag();
    return true;
  }

  /** A move of the pointer pressed: true when it was the editor's. */
  move(event: PointerEvent): boolean {
    const held = this.drag ?? this.drawing;
    if (held?.pointer !== event.pointerId) return false;
    held.moved ||= Math.hypot(event.offsetX - held.from.x, event.offsetY - held.from.y) >= TAP_SLOP;
    if (!held.moved) return true;
    const drawing = this.drawing;
    if (drawing) {
      const p = this.planAt(event.offsetX, event.offsetY);
      if (p) {
        const { point, guides } = this.planner.snap(p);
        drawing.end = point;
        drawing.guides = guides;
      }
      this.host.planChanged();
    } else {
      this.pending = { x: event.offsetX, y: event.offsetY };
      this.host.redraw();
    }
    return true;
  }

  /** Moves the held corner or selection to the last pointer position (once per frame). */
  flush(): void {
    const to = this.pending;
    const drag = this.drag;
    if (!to || !drag) return;
    this.pending = undefined;
    const p = this.planAt(to.x, to.y);
    if (!p) return;
    const planner = this.planner;
    if (drag.kind === "corner") {
      const { point, guides } = planner.snap(p, drag.room);
      this.guides = guides;
      this.run(() => {
        planner.moveCorner(drag.room, drag.corner, point);
      }, true);
      return;
    }
    // A room's first corner snaps; partitions, doors and windows follow the pointer.
    let target: PlanPoint = [
      drag.anchor[0] + p[0] - drag.grab[0],
      drag.anchor[1] + p[1] - drag.grab[1],
    ];
    this.guides = [];
    if (drag.room) {
      const snapped = planner.snap(target, drag.id);
      target = snapped.point;
      this.guides = snapped.guides;
    }
    const now = planner.anchor(drag.id) ?? drag.anchor;
    const d: PlanPoint = [target[0] - now[0], target[1] - now[1]];
    if (Math.abs(d[0]) < 1e-9 && Math.abs(d[1]) < 1e-9) {
      this.refresh();
      return;
    }
    this.run(() => {
      planner.moveElement(drag.id, d);
    }, true);
  }

  /** The pointer let go: ends the drag or the drawing. True when it was the editor's. */
  up(event: PointerEvent): boolean {
    const drag = this.drag;
    if (drag?.pointer === event.pointerId) {
      if (drag.moved) this.pending = { x: event.offsetX, y: event.offsetY };
      this.flush();
      this.endDrag();
      // Pressed without moving: a tap, which selects what is there.
      if (!drag.moved) this.tap(drag.from.x, drag.from.y);
      return true;
    }
    const drawing = this.drawing;
    if (drawing?.pointer !== event.pointerId) return false;
    this.drawing = undefined;
    const planner = this.planner;
    if (this.tool === "room") {
      let [a, b] = [drawing.start, drawing.end];
      if (!drawing.moved) {
        // A tap drops a room of 300 × 300 cm there.
        const half = TAP_ROOM / 2;
        a = planner.snap([a[0] - half, a[1] - half]).point;
        b = planner.snap([a[0] + TAP_ROOM, a[1] + TAP_ROOM]).point;
      }
      this.run(() => {
        this.select(planner.addRoom(a, b, this.nameOf("room")));
      });
    } else if (drawing.moved) {
      this.run(() => {
        this.select(planner.addWall(drawing.start, drawing.end, this.nameOf("wall")));
      });
    } else {
      this.host.planChanged();
    }
    return true;
  }

  private endDrag(): void {
    this.drag = undefined;
    this.pending = undefined;
    this.planner.endDrag();
    this.guides = [];
    this.refresh();
  }

  /** The pointer was taken away (another gesture, the page): the drag ends, a drawing is dropped. */
  cancel(event: PointerEvent): boolean {
    if (this.drag?.pointer === event.pointerId) {
      this.flush();
      this.endDrag();
      return true;
    }
    if (this.drawing?.pointer !== event.pointerId) return false;
    this.drawing = undefined;
    this.host.planChanged();
    return true;
  }

  /** A tap (CSS pixels): selects, or places a door or a window on the nearest side. */
  tap(x: number, y: number): void {
    const p = this.host.devicePoint(x, y);
    if (this.tool === "select") {
      const picked = this.engine.pick(p.x, p.y);
      // A piece of furniture selects the room it stands in (furniture is arranged in edit mode).
      const id = picked ? (picked.type === "furniture" ? picked.room || null : picked.id) : null;
      this.select(id);
      this.error = null;
      // Only the marks change: the scene stays as it is.
      this.engine.markSelected(id ?? "");
      this.refresh();
      return;
    }
    if (this.tool !== "door" && this.tool !== "window") return;
    const tool = this.tool;
    const at = this.engine.planPoint(p.x, p.y);
    if (!at) return;
    this.run(() => {
      const id = this.planner.addOpening(tool === "door", at, this.nameOf(tool));
      if (!id) throw new EngineError("no_side");
      this.select(id);
    });
  }

  /** Runs a command of the plan bar or of the keys. */
  command(command: PlanCommand): void {
    const planner = this.planner;
    const id = this.selection;
    // Escape drops a shape being drawn; nothing else while a corner or the selection is held or
    // a shape drawn.
    if (command === "clear" && this.drawing) {
      this.drawing = undefined;
      this.host.planChanged();
      return;
    }
    if (this.drag || this.drawing) return;
    switch (command) {
      case "undo":
      case "redo":
        if (command === "undo" ? planner.undo() : planner.redo()) {
          // An element the step took away is no longer selected; corners may be others now.
          if (id && !planner.element(id)) this.selection = null;
          this.corner = null;
          this.error = null;
          this.show();
        }
        this.refresh();
        break;
      case "remove":
        if (id) {
          this.run(() => {
            planner.remove(id);
            this.select(null);
          });
        }
        break;
      case "clear":
        this.select(null);
        this.engine.markSelected("");
        this.refresh();
        break;
      case "remove-corner": {
        const corner = this.corner;
        if (id && corner !== null) {
          this.run(() => {
            planner.removeCorner(id, corner);
            this.corner = null;
          });
        }
        break;
      }
    }
  }

  /** Changes fields of the selection. */
  update(fields: Record<string, unknown>): void {
    const id = this.selection;
    if (id) {
      this.run(() => {
        this.planner.update(id, fields);
      });
    }
  }

  /** Adds a corner in the middle of side `side` of the selected room. */
  insertCorner(side: number): void {
    const id = this.selection;
    const points = id ? this.planner.roomPoints(id) : [];
    const a = points[side];
    const b = points[(side + 1) % points.length];
    if (!id || !a || !b) return;
    this.run(() => {
      this.planner.insertCorner(id, side, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      this.corner = side + 1;
    });
  }

  /** Puts a plan kept by the browser in place, as one change that can be undone. */
  restore(plan: Record<string, unknown>): void {
    this.run(() => {
      this.planner.replace(plan);
      this.select(null);
    });
  }

  /** The draft was stored as it is. */
  saved(): void {
    this.planner.markSaved();
    this.refresh();
  }

  /** Ids new elements must not take (those whose links are stored now). */
  reserve(ids: string[]): void {
    this.planner.reserve(ids);
  }

  /** Gives the draft away (the view leaves the page): this editor is not used any more. */
  release(): Planner {
    return this.planner;
  }

  dispose(): void {
    this.planner.dispose();
  }

  /** The handles over the plan; `k` turns device pixels into CSS pixels. */
  render(k: number): TemplateResult {
    const t = this.t;
    const format = new Intl.NumberFormat(t.language, { maximumFractionDigits: 0 });
    const state = this.state;
    const drawing = this.drawing;
    const guides = drawing ? this.drawingGuides(drawing) : state.guides;
    const corners = state.corners.map((c) => ({ i: c.i, x: c.x * k, y: c.y * k }));
    const centre = corners.reduce(
      (sum, c) => ({ x: sum.x + c.x / corners.length, y: sum.y + c.y / corners.length }),
      { x: 0, y: 0 },
    );
    const room = state.selection?.type === "room";
    return svg`<svg class="plan-handles" data-testid="plan-handles" aria-hidden="true">
      ${guides.map(
        (g) =>
          svg`<line class="snap" x1=${g.a[0] * k} y1=${g.a[1] * k} x2=${g.b[0] * k} y2=${g.b[1] * k}></line>`,
      )}
      ${room ? this.renderSides(k, corners, centre, format) : nothing}
      ${
        room
          ? corners.map(
              (c) =>
                svg`<circle class=${c.i === state.corner ? "corner active" : "corner"} data-corner=${c.i} cx=${c.x} cy=${c.y} r="7"></circle>`,
            )
          : nothing
      }
      ${drawing?.moved ? this.renderDrawing(drawing, k, format) : nothing}
    </svg>`;
  }

  /** The guides of the point being drawn, where the camera draws them. */
  private drawingGuides(drawing: Drawing): PlanScreenGuide[] {
    if (drawing.guides.length === 0) return [];
    const screen = this.engine.screenPoints(drawing.guides.flatMap((g) => [...g.a, ...g.b]));
    return drawing.guides.map((_, i) => ({
      a: [screen[4 * i] ?? NaN, screen[4 * i + 1] ?? NaN],
      b: [screen[4 * i + 2] ?? NaN, screen[4 * i + 3] ?? NaN],
    }));
  }

  private renderSides(
    k: number,
    corners: { i: number; x: number; y: number }[],
    centre: Point,
    format: Intl.NumberFormat,
  ): TemplateResult[] {
    const t = this.t;
    const count = this.state.cornerCount;
    return this.state.sides.map((side) => {
      const a = corners.find((c) => c.i === side.i);
      const b = corners.find((c) => c.i === (side.i + 1) % count);
      const mid = { x: side.x * k, y: side.y * k };
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < MIN_LABELLED_SIDE) {
        return svg``;
      }
      const label = sideLabel(a, b, mid, centre);
      const length = svg`<text class="length" x=${label.x} y=${label.y}>${format.format(side.cm)} cm</text>`;
      // Corners are added with the select tool only: with the others, a tap places or draws.
      if (this.tool !== "select") return length;
      const text = t.t("plan.add_corner");
      // A button of the SVG: the only handles the pointer reaches (corners are grabbed under the
      // press, see `grab`).
      return svg`${length}
        <g class="insert" role="button" tabindex="0" aria-label=${text} data-side=${side.i}
          @click=${() => {
            this.insertCorner(side.i);
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.insertCorner(side.i);
          }}>
          <title>${text}</title>
          <circle cx=${mid.x} cy=${mid.y} r="9"></circle>
          <path d=${`M${mid.x - 4} ${mid.y}h8M${mid.x} ${mid.y - 4}v8`}></path>
        </g>`;
    });
  }

  private renderDrawing(drawing: Drawing, k: number, format: Intl.NumberFormat): TemplateResult {
    const screen = this.engine.screenPoints([...drawing.start, ...drawing.end]);
    const [x1, y1, x2, y2] = [0, 1, 2, 3].map((i) => (screen[i] ?? NaN) * k) as [
      number,
      number,
      number,
      number,
    ];
    const w = Math.abs(drawing.end[0] - drawing.start[0]);
    const h = Math.abs(drawing.end[1] - drawing.start[1]);
    if (this.tool === "wall") {
      const length = Math.hypot(w, h);
      return svg`<line class="drawn" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
        <text class="length" x=${(x1 + x2) / 2} y=${(y1 + y2) / 2 - LABEL_OFFSET}>${format.format(length)} cm</text>`;
    }
    return svg`<rect class="drawn" x=${Math.min(x1, x2)} y=${Math.min(y1, y2)}
        width=${Math.abs(x2 - x1)} height=${Math.abs(y2 - y1)}></rect>
      <text class="length" x=${(x1 + x2) / 2} y=${(y1 + y2) / 2}>${format.format(w)} × ${format.format(h)} cm</text>`;
  }
}
