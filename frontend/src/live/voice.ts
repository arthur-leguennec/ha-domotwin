/**
 * Voice at hand (D-041). Home Assistant's Assist listens, understands and answers with the
 * pipeline the user set up; DomoTwin only opens it already listening, says why it cannot (a page
 * served over HTTP gets no microphone), and helps administrators set voice up.
 */
import { fire } from "../components/define";
import type { HomeAssistant } from "../ha/types";

/** DomoTwin's voice blueprints and whether each is in Home Assistant's blueprint folder. */
export type BlueprintName = "show_by_voice" | "where_by_voice";
export type BlueprintStatus = "missing" | "installed" | "changed";

/** The steps of local voice being set up on the Supervisor. */
export type SetupStep =
  "idle" | "checking" | "installing" | "starting" | "connecting" | "pipeline" | "done" | "failed";

/** The apps that hear: Whisper understands anything, Speech-to-Phrase is quick on a Pi. */
export type SpeechApp = "whisper" | "speech-to-phrase";

export interface VoiceState {
  /** Home Assistant OS or Supervised: apps can be installed. */
  supervisor: boolean;
  blueprints: Record<BlueprintName, BlueprintStatus>;
  setup: { step: SetupStep; app: string | null; error: string | null; pipeline: string | null };
  /** For the steps on Container and Core: Whisper's language and Piper's voice for the home's. */
  language: string;
  piper_voice: string;
}

/** An Assist pipeline, as `assist_pipeline/pipeline/list` gives it. */
interface Pipeline {
  id: string;
  name?: string;
  stt_engine?: string | null;
}

export async function voiceState(hass: HomeAssistant): Promise<VoiceState> {
  return hass.connection.sendMessagePromise<VoiceState>({ type: "domotwin/voice/get" });
}

/** Installs the blueprints (the edited ones too with `replace`). Admins only. */
export async function installBlueprints(
  hass: HomeAssistant,
  replace: boolean,
): Promise<Record<BlueprintName, BlueprintStatus>> {
  const result = await hass.connection.sendMessagePromise<{
    blueprints: Record<BlueprintName, BlueprintStatus>;
  }>({ type: "domotwin/voice/blueprints", replace });
  return result.blueprints;
}

/** Starts setting up local voice on the Supervisor. Admins only. */
export async function setUpVoice(hass: HomeAssistant, stt: SpeechApp): Promise<void> {
  await hass.connection.sendMessagePromise({ type: "domotwin/voice/setup", stt });
}

async function pipelines(
  hass: HomeAssistant,
): Promise<{ pipelines: Pipeline[]; preferred_pipeline?: string | null }> {
  return hass.connection.sendMessagePromise({ type: "assist_pipeline/pipeline/list" });
}

/**
 * The pipeline to listen with: the preferred one when it hears, else the first that does;
 * `undefined` when none hears (voice is not set up).
 */
export async function listeningPipeline(hass: HomeAssistant): Promise<string | undefined> {
  const list = await pipelines(hass);
  const hears = (p: Pipeline): boolean => typeof p.stt_engine === "string" && p.stt_engine !== "";
  const preferred = list.pipelines.find((p) => p.id === list.preferred_pipeline);
  return (preferred && hears(preferred) ? preferred : list.pipelines.find(hears))?.id;
}

/** Whether Assist runs here at all (the conversation integration is loaded). */
export function assistAvailable(hass: HomeAssistant | undefined): boolean {
  return hass?.config?.components?.includes("conversation") === true;
}

/**
 * Whether the browser lends the microphone: pages served over HTTPS (or from this computer) only.
 * The companion apps listen themselves.
 */
export function canListen(hass: HomeAssistant): boolean {
  const external = (hass as { auth?: { external?: { config?: { hasAssist?: boolean } } } }).auth
    ?.external;
  return globalThis.isSecureContext || external?.config?.hasAssist === true;
}

/** Opens Home Assistant's Assist dialog, listening with `pipeline` (or for typing). */
export function openAssist(node: HTMLElement, pipeline: string, listen: boolean): void {
  fire(node, "hass-action", {
    config: { tap_action: { action: "assist", pipeline_id: pipeline, start_listening: listen } },
    action: "tap",
  });
}
