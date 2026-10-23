import { describe, expect, it } from "vitest";

import { GestureTracker, wheelFactor, type PointerSample } from "../src/gestures";

function sample(
  pointerId: number,
  x: number,
  y: number,
  time: number,
  extra: Partial<PointerSample> = {},
): PointerSample {
  return { pointerId, x, y, time, button: 0, shiftKey: false, ...extra };
}

describe("GestureTracker", () => {
  it("drags with one pointer once it moved past the tap slop", () => {
    const tracker = new GestureTracker();
    tracker.down(sample(1, 100, 100, 0));
    expect(tracker.move(sample(1, 103, 100, 10))).toEqual([]);
    expect(tracker.move(sample(1, 120, 110, 20))).toEqual([{ kind: "drag", dx: 17, dy: 10 }]);
    expect(tracker.up(sample(1, 120, 110, 30))).toEqual([]);
  });

  it("pans with the right button or Shift", () => {
    const tracker = new GestureTracker();
    tracker.down(sample(1, 0, 0, 0, { button: 2 }));
    expect(tracker.move(sample(1, 20, 0, 10))).toEqual([{ kind: "pan", dx: 20, dy: 0 }]);
    tracker.up(sample(1, 20, 0, 20));
    tracker.down(sample(2, 0, 0, 100, { shiftKey: true }));
    expect(tracker.move(sample(2, 0, 30, 110))).toEqual([{ kind: "pan", dx: 0, dy: 30 }]);
  });

  it("pinches to zoom about the fingers and pans with them", () => {
    const tracker = new GestureTracker();
    tracker.down(sample(1, 100, 100, 0));
    tracker.down(sample(2, 200, 100, 5));
    const gestures = tracker.move(sample(2, 300, 100, 10));
    expect(gestures[0]).toEqual({ kind: "zoom", factor: 0.5, x: 200, y: 100 });
    expect(gestures[1]).toEqual({ kind: "pan", dx: 50, dy: 0 });
    // Lifting the fingers after a pinch is not a tap.
    expect(tracker.up(sample(2, 300, 100, 20))).toEqual([]);
    expect(tracker.up(sample(1, 100, 100, 30))).toEqual([]);
  });

  it("taps and double taps", () => {
    const tracker = new GestureTracker();
    tracker.down(sample(1, 50, 50, 0));
    expect(tracker.up(sample(1, 51, 50, 100))).toEqual([{ kind: "tap", x: 51, y: 50 }]);
    tracker.down(sample(1, 52, 52, 200));
    expect(tracker.up(sample(1, 52, 52, 250))).toEqual([{ kind: "double-tap", x: 52, y: 52 }]);
    // A long press is not a tap.
    tracker.down(sample(1, 52, 52, 1000));
    expect(tracker.up(sample(1, 52, 52, 1600))).toEqual([]);
  });

  it("forgets cancelled pointers", () => {
    const tracker = new GestureTracker();
    tracker.down(sample(1, 0, 0, 0));
    tracker.cancel(1);
    expect(tracker.active).toBe(0);
    expect(tracker.up(sample(1, 0, 0, 10))).toEqual([]);
  });
});

describe("wheelFactor", () => {
  it("zooms in on negative deltas and clamps big jumps", () => {
    expect(wheelFactor(-100, 0)).toBeLessThan(1);
    expect(wheelFactor(100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0));
    expect(wheelFactor(1e9, 0)).toBeCloseTo(Math.exp(0.3));
  });
});
