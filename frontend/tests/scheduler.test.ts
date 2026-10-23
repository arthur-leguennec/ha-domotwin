import { describe, expect, it } from "vitest";

import { FrameScheduler, type FrameClock } from "../src/scheduler";

class FakeClock implements FrameClock {
  time = 0;
  private callbacks = new Map<number, (time: number) => void>();
  private next = 1;

  request(callback: (time: number) => void): number {
    this.callbacks.set(this.next, callback);
    return this.next++;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  get pending(): number {
    return this.callbacks.size;
  }

  /** Runs one display refresh, 16 ms later. */
  tick(): void {
    this.time += 16;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(this.time);
  }
}

describe("FrameScheduler", () => {
  it("draws nothing until asked, then one frame", () => {
    const clock = new FakeClock();
    const scheduler = new FrameScheduler(() => false, clock);
    clock.tick();
    expect(scheduler.frames).toBe(0);
    scheduler.request();
    scheduler.request();
    expect(clock.pending).toBe(1);
    clock.tick();
    clock.tick();
    expect(scheduler.frames).toBe(1);
  });

  it("keeps drawing while an animation runs, then stops (idle CPU ≈ 0)", () => {
    const clock = new FakeClock();
    let remaining = 3;
    const scheduler = new FrameScheduler(() => --remaining > 0, clock);
    scheduler.request();
    for (let i = 0; i < 10; i += 1) clock.tick();
    expect(scheduler.frames).toBe(3);
    expect(clock.pending).toBe(0);
  });

  it("pauses off-screen and when the page is hidden, and resumes", () => {
    const clock = new FakeClock();
    const scheduler = new FrameScheduler(() => false, clock);
    scheduler.setOnScreen(false);
    scheduler.request();
    clock.tick();
    expect(scheduler.frames).toBe(0);
    expect(scheduler.paused).toBe(true);
    scheduler.setOnScreen(true);
    clock.tick();
    expect(scheduler.frames).toBe(1);

    scheduler.request();
    scheduler.setPageVisible(false);
    expect(clock.pending).toBe(0);
    scheduler.setPageVisible(true);
    clock.tick();
    expect(scheduler.frames).toBe(2);
  });

  it("caps the frame rate of animations", () => {
    const clock = new FakeClock();
    const scheduler = new FrameScheduler(() => true, clock);
    scheduler.setMinInterval(1000 / 24);
    scheduler.request();
    for (let i = 0; i < 60; i += 1) clock.tick(); // ≈ 1 s at 60 Hz
    expect(scheduler.frames).toBeGreaterThanOrEqual(19);
    expect(scheduler.frames).toBeLessThanOrEqual(24);
  });

  it("stops for good once disposed", () => {
    const clock = new FakeClock();
    const scheduler = new FrameScheduler(() => true, clock);
    scheduler.request();
    scheduler.dispose();
    scheduler.request();
    clock.tick();
    expect(scheduler.frames).toBe(0);
  });
});
