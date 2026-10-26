/**
 * What the "Measure performance" button measured (D-053), and the row it gives for the table of
 * real devices in `docs/PERFORMANCE.md`. Nothing here is sent or kept: the row is for the user to
 * copy.
 */
import type { FrameStats } from "../components/view";

/** The device measured, as the browser describes it. */
export interface DeviceInfo {
  userAgent: string;
  /** The screen (CSS pixels) and its pixel ratio. */
  screen: { width: number; height: number; pixelRatio: number };
  /** Logical processors (`navigator.hardwareConcurrency`). */
  cores?: number;
  /** Memory in GB, rounded by the browser (`navigator.deviceMemory`, Chromium only). */
  memoryGb?: number;
  /** The GPU drawing the view, as WebGL names it. */
  renderer?: string;
  /** Touch points: an iPad says it is a Mac, and has a touch screen. */
  touch?: number;
  /** In Home Assistant's companion app rather than a browser. */
  app: boolean;
  /** DomoTwin's version. */
  version: string;
}

/** One look measured: the camera turning, then still while a lamp dims. */
export interface LookRun {
  look: string;
  /** The quality `auto` chose, and the scale of the drawing buffer. */
  quality?: string;
  resolution: number;
  triangles?: number;
  turning: FrameStats;
  still: FrameStats;
}

/** A whole measure. */
export interface MeasureReport {
  device: DeviceInfo;
  /** From opening the panel to the first picture of the home (ms), when it was drawn. */
  firstPictureMs?: number;
  runs: LookRun[];
}

/** The columns of the table of real devices, as `docs/PERFORMANCE.md` has them. */
export const MARKDOWN_COLUMNS = [
  "Device",
  "Screen",
  "Cores, memory",
  "GPU",
  "DomoTwin",
  "Look",
  "Quality, scale",
  "First picture",
  "Turning: fps, p95 interval",
  "Turning: CPU median, p95",
  "Still: fps, p95 interval",
  "Still: CPU median, p95",
  "Wasm memory",
  "Triangles",
] as const;

/** What a value the browser did not give shows as. */
export const MISSING = "—";

/** The table's header and its separator. */
export function markdownHeader(): string {
  return `| ${MARKDOWN_COLUMNS.join(" | ")} |\n|${MARKDOWN_COLUMNS.map(() => " --- ").join("|")}|`;
}

/** The frames a second of a run, from the median interval between its frames. */
export function framesPerSecond(stats: FrameStats): number | undefined {
  return stats.intervalMedianMs > 0 ? 1000 / stats.intervalMedianMs : undefined;
}

/** The system and the browser a user agent says, briefly ("Android 14 · Chrome 141"). */
export function deviceName(userAgent: string, touch = 0): string {
  const ua = userAgent;
  let system: string | undefined;
  let match: RegExpMatchArray | null;
  if ((match = /Android (\d+(?:\.\d+)?)/.exec(ua))) system = `Android ${match[1] ?? ""}`;
  else if ((match = /(?:iPhone|CPU) OS (\d+)[._](\d+)/.exec(ua))) {
    system = `${/iPad/.test(ua) ? "iPadOS" : "iOS"} ${match[1] ?? ""}.${match[2] ?? ""}`;
  } else if (/Macintosh/.test(ua)) system = touch > 1 ? "iPadOS" : "macOS";
  else if (/CrOS/.test(ua)) system = "ChromeOS";
  else if (/Windows/.test(ua)) system = "Windows";
  else if (/Linux/.test(ua)) system = "Linux";
  let browser: string | undefined;
  if ((match = /Edg(?:A|iOS)?\/(\d+)/.exec(ua))) browser = `Edge ${match[1] ?? ""}`;
  else if ((match = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua))) browser = `Firefox ${match[1] ?? ""}`;
  else if ((match = /SamsungBrowser\/(\d+)/.exec(ua)))
    browser = `Samsung Internet ${match[1] ?? ""}`;
  else if ((match = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) browser = `Chrome ${match[1] ?? ""}`;
  else if ((match = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua)))
    browser = `Safari ${match[1] ?? ""}`;
  return [system, browser].filter((part) => part !== undefined).join(" · ") || ua.slice(0, 60);
}

/** The browser around the page: the device as the browser describes it. */
export function readDevice(
  version: string,
  renderer: string | undefined,
  where: {
    navigator: Navigator & { deviceMemory?: number };
    screen: { width: number; height: number };
    devicePixelRatio: number;
    externalApp?: unknown;
    webkit?: { messageHandlers?: { externalBus?: unknown } };
  } = window,
): DeviceInfo {
  const nav = where.navigator;
  const device: DeviceInfo = {
    userAgent: nav.userAgent,
    screen: {
      width: where.screen.width,
      height: where.screen.height,
      pixelRatio: where.devicePixelRatio || 1,
    },
    // Home Assistant's companion apps talk to their page through these, and name themselves in
    // the user agent.
    app:
      where.externalApp !== undefined ||
      where.webkit?.messageHandlers?.externalBus !== undefined ||
      /Home ?Assistant\//i.test(nav.userAgent),
    version,
  };
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0) {
    device.cores = nav.hardwareConcurrency;
  }
  if (typeof nav.maxTouchPoints === "number" && nav.maxTouchPoints > 0) {
    device.touch = nav.maxTouchPoints;
  }
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0) {
    device.memoryGb = nav.deviceMemory;
  }
  if (renderer) device.renderer = renderer;
  return device;
}

const round = (value: number, digits: number): string => {
  const k = 10 ** digits;
  return String(Math.round(value * k) / k);
};

/** A cell: no pipe nor line break of its own. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || MISSING;
}

function speed(stats: FrameStats): string {
  const fps = framesPerSecond(stats);
  return fps === undefined ? MISSING : `${round(fps, 0)} fps, ${round(stats.intervalP95Ms, 1)} ms`;
}

function cpu(stats: FrameStats): string {
  return `${round(stats.cpuMedianMs, 1)} / ${round(stats.cpuP95Ms, 1)} ms`;
}

/** The table rows of a measure, one per look, ready to paste in `docs/PERFORMANCE.md`. */
export function markdownRows(report: MeasureReport): string {
  const { device } = report;
  const screen = `${device.screen.width}×${device.screen.height} @${round(device.screen.pixelRatio, 2)}`;
  const hardware = [
    device.cores !== undefined ? `${device.cores} cores` : undefined,
    device.memoryGb !== undefined ? `${round(device.memoryGb, 1)} GB` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
  const where = `${deviceName(device.userAgent, device.touch)} (${device.app ? "Home Assistant app" : "browser"})`;
  const first =
    report.firstPictureMs !== undefined ? `${round(report.firstPictureMs / 1000, 1)} s` : MISSING;
  return report.runs
    .map((run) => {
      const memory = Math.max(run.turning.wasmMemoryBytes, run.still.wasmMemoryBytes);
      const cells = [
        where,
        screen,
        hardware,
        device.renderer ?? "",
        device.version,
        run.look,
        `${run.quality ?? MISSING}, ${round(run.resolution, 2)}`,
        first,
        speed(run.turning),
        cpu(run.turning),
        speed(run.still),
        cpu(run.still),
        memory > 0 ? `${round(memory / 1_000_000, 1)} MB` : "",
        run.triangles !== undefined ? String(run.triangles) : "",
      ];
      return `| ${cells.map(cell).join(" | ")} |`;
    })
    .join("\n");
}
