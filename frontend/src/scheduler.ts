/**
 * Render on demand: a frame is drawn only when something asked for it (camera move, state change,
 * animation, edit drag) and never while the view is off-screen or the page hidden.
 */
export interface FrameClock {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

export class FrameScheduler {
  /** Frames drawn since creation (for tests and diagnostics). */
  frames = 0;
  private pending: number | undefined;
  private wanted = false;
  private onScreen = true;
  private pageVisible = true;
  private interval = 0;
  /** When the next capped frame is due. */
  private due = Number.NEGATIVE_INFINITY;
  private disposed = false;

  /**
   * @param draw draws one frame and returns true while an animation needs more frames.
   */
  constructor(
    private readonly draw: (time: number) => boolean,
    private readonly clock: FrameClock = browserClock,
  ) {}

  /** Asks for one frame. */
  request(): void {
    this.wanted = true;
    this.schedule();
  }

  /** Whether the view intersects the viewport. */
  setOnScreen(onScreen: boolean): void {
    this.onScreen = onScreen;
    this.update();
  }

  /** Whether the page is visible (`document.visibilityState`). */
  setPageVisible(visible: boolean): void {
    this.pageVisible = visible;
    this.update();
  }

  /** Caps the frame rate of animations (e.g. 1000 / 24 for the heatmap); 0 = display rate. */
  setMinInterval(milliseconds: number): void {
    this.interval = Math.max(0, milliseconds);
  }

  /** The frame rate cap of animations (ms between frames; 0: the display's rate). */
  get minInterval(): number {
    return this.interval;
  }

  get running(): boolean {
    return this.pending !== undefined;
  }

  get paused(): boolean {
    return !this.onScreen || !this.pageVisible;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private update(): void {
    if (this.paused) this.cancel();
    else this.schedule();
  }

  private cancel(): void {
    if (this.pending !== undefined) this.clock.cancel(this.pending);
    this.pending = undefined;
  }

  private schedule(): void {
    if (this.disposed || !this.wanted || this.pending !== undefined || this.paused) return;
    this.pending = this.clock.request((time) => {
      this.pending = undefined;
      // Half a millisecond early is on time: display ticks rarely land exactly on the interval.
      if (time < this.due - 0.5) {
        this.schedule();
        return;
      }
      this.wanted = false;
      // The next frame is due one interval after this one was due, not after it was drawn: a
      // 60 Hz display then alternates two and three ticks (24 frames per second, not 20).
      this.due = time - this.due < this.interval ? this.due + this.interval : time + this.interval;
      this.frames += 1;
      if (this.draw(time)) this.request();
    });
  }
}
