import { afterEach, describe, expect, it, vi } from "vitest";

import type { HomeAssistant } from "../src/ha/types";
import {
  assistAvailable,
  canListen,
  listeningPipeline,
  readDeviceVoice,
  writeDeviceVoice,
} from "../src/live/voice";

/** Home Assistant with these Assist pipelines; what it was asked is kept. */
function hass(
  pipelines: { id: string; stt_engine?: string | null }[],
  preferred: string,
): { hass: HomeAssistant; asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    hass: {
      language: "en",
      states: {},
      config: { components: ["conversation"] },
      callService: () => Promise.resolve(),
      connection: {
        sendMessagePromise: (message: unknown) => {
          asked.push(message);
          return Promise.resolve({ pipelines, preferred_pipeline: preferred } as never);
        },
      } as unknown as HomeAssistant["connection"],
    },
  };
}

describe("voice at hand (D-041)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listens with the preferred pipeline when it hears, else with one that does", async () => {
    const both = [
      { id: "text", stt_engine: null },
      { id: "cloud", stt_engine: "stt.cloud" },
      { id: "local", stt_engine: "stt.whisper" },
    ];
    expect(await listeningPipeline(hass(both, "local").hass)).toBe("local");
    expect(await listeningPipeline(hass(both, "text").hass)).toBe("cloud");
    expect(await listeningPipeline(hass([{ id: "text", stt_engine: "" }], "text").hass)).toBe(
      undefined,
    );
  });

  it("the microphone over HTTPS, or in the app that listens itself", () => {
    const { hass: home } = hass([], "");
    expect(assistAvailable(home)).toBe(true);
    expect(assistAvailable({ ...home, config: { components: [] } })).toBe(false);
    vi.stubGlobal("isSecureContext", true);
    expect(canListen(home)).toBe(true);
    vi.stubGlobal("isSecureContext", false);
    expect(canListen(home)).toBe(false);
    const app = { ...home, auth: { external: { config: { hasAssist: true } } } };
    expect(canListen(app as HomeAssistant)).toBe(true);
  });
});

describe("voice off on a device (D-085)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("is on until turned off here, and kept on the device", () => {
    expect(readDeviceVoice()).toBe(true);
    writeDeviceVoice(false);
    expect(readDeviceVoice()).toBe(false);
    expect(window.localStorage.getItem("domotwin-voice")).toBe("off");
    writeDeviceVoice(true);
    expect(readDeviceVoice()).toBe(true);
    expect(window.localStorage.getItem("domotwin-voice")).toBeNull();
    // Anything else kept there is not "off".
    window.localStorage.setItem("domotwin-voice", "maybe");
    expect(readDeviceVoice()).toBe(true);
  });

  it("stays on when the browser keeps nothing", () => {
    // Storage refused: reaching it throws, as in a browser that blocks it.
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => {
      writeDeviceVoice(false);
    }).not.toThrow();
    expect(readDeviceVoice()).toBe(true);
  });
});
