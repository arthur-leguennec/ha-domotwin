/**
 * Turns pointer events into camera gestures, without touching the DOM (unit-tested):
 *
 * - one finger or the left mouse button drags (turn in 3D, move on the 2D plan);
 * - the right or middle button, or Shift + drag, moves the view;
 * - two fingers pinch to zoom and move together to pan;
 * - a short press without moving is a tap; two taps close together are a double tap;
 * - a press held still for `HOLD_TIME` is a long press (`hold`), checked by a timer of the view.
 */

/** What a gesture asks the camera to do. Distances are CSS pixels. */
export type Gesture =
  | { kind: "drag"; dx: number; dy: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "zoom"; factor: number; x: number; y: number }
  | { kind: "tap"; x: number; y: number }
  | { kind: "double-tap"; x: number; y: number }
  | { kind: "hold"; x: number; y: number };

/** The fields of a `PointerEvent` the tracker needs. */
export interface PointerSample {
  pointerId: number;
  x: number;
  y: number;
  button: number;
  shiftKey: boolean;
  time: number;
}

/** A press shorter than this (ms) that moved less than `TAP_SLOP` is a tap. */
export const TAP_TIME = 500;
/** Movement (CSS pixels) below which a press is still a tap. */
export const TAP_SLOP = 6;
/** A press held still this long (ms) is a long press. */
export const HOLD_TIME = 500;
/** Two taps closer than this (ms and CSS pixels) make a double tap. */
export const DOUBLE_TAP_TIME = 320;
const DOUBLE_TAP_SLOP = 24;

interface Tracked {
  x: number;
  y: number;
}

export class GestureTracker {
  private readonly pointers = new Map<number, Tracked>();
  private panning = false;
  private start?: { x: number; y: number; time: number };
  private moved = false;
  private held = false;
  private lastTap?: { x: number; y: number; time: number };

  /** Pointers currently down. */
  get active(): number {
    return this.pointers.size;
  }

  down(sample: PointerSample): Gesture[] {
    this.pointers.set(sample.pointerId, { x: sample.x, y: sample.y });
    if (this.pointers.size === 1) {
      this.panning = sample.button === 1 || sample.button === 2 || sample.shiftKey;
      this.start = { x: sample.x, y: sample.y, time: sample.time };
      this.moved = false;
      this.held = false;
    } else {
      // A second finger: never a tap.
      this.moved = true;
    }
    return [];
  }

  move(sample: PointerSample): Gesture[] {
    const pointer = this.pointers.get(sample.pointerId);
    if (!pointer) return [];
    if (this.pointers.size === 1) {
      const dx = sample.x - pointer.x;
      const dy = sample.y - pointer.y;
      pointer.x = sample.x;
      pointer.y = sample.y;
      if (
        this.start &&
        !this.moved &&
        Math.hypot(sample.x - this.start.x, sample.y - this.start.y) < TAP_SLOP
      ) {
        return [];
      }
      this.moved = true;
      if (dx === 0 && dy === 0) return [];
      return [{ kind: this.panning ? "pan" : "drag", dx, dy }];
    }
    // Two (or more) pointers: the first two pinch and pan.
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return [];
    const before = {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      d: Math.hypot(a.x - b.x, a.y - b.y),
    };
    pointer.x = sample.x;
    pointer.y = sample.y;
    const after = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    const gestures: Gesture[] = [];
    if (before.d > 1 && after.d > 1 && before.d !== after.d) {
      gestures.push({ kind: "zoom", factor: before.d / after.d, x: after.cx, y: after.cy });
    }
    const dx = after.cx - before.cx;
    const dy = after.cy - before.cy;
    if (dx !== 0 || dy !== 0) gestures.push({ kind: "pan", dx, dy });
    return gestures;
  }

  up(sample: PointerSample): Gesture[] {
    if (!this.pointers.delete(sample.pointerId)) return [];
    if (this.pointers.size > 0) return [];
    const start = this.start;
    this.start = undefined;
    if (!start || this.moved || this.held || sample.time - start.time > TAP_TIME) return [];
    const last = this.lastTap;
    if (
      last &&
      sample.time - last.time < DOUBLE_TAP_TIME &&
      Math.hypot(sample.x - last.x, sample.y - last.y) < DOUBLE_TAP_SLOP
    ) {
      this.lastTap = undefined;
      return [{ kind: "double-tap", x: sample.x, y: sample.y }];
    }
    this.lastTap = { x: sample.x, y: sample.y, time: sample.time };
    return [{ kind: "tap", x: sample.x, y: sample.y }];
  }

  /** A long press, once, if the only pointer has stayed still for `HOLD_TIME` at `time`. */
  hold(time: number): Gesture[] {
    const start = this.start;
    if (!start || this.pointers.size !== 1 || this.moved || this.held) return [];
    if (time - start.time < HOLD_TIME) return [];
    this.held = true;
    return [{ kind: "hold", x: start.x, y: start.y }];
  }

  /** The last tap acted on something: the next one starts afresh (no double tap). */
  forgetTap(): void {
    this.lastTap = undefined;
  }

  /** The pointer left without a normal release (`pointercancel`). */
  cancel(pointerId: number): void {
    this.pointers.delete(pointerId);
    if (this.pointers.size === 0) this.start = undefined;
    this.moved = true;
  }
}

/** Zoom factor of a wheel event (< 1 zooms in); `deltaMode` 1 is lines, 2 pages. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(Math.max(-200, Math.min(200, pixels)) * 0.0015);
}
