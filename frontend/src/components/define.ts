import type { ReactiveElement } from "lit";

import { speak, translatorFor, type Speaking } from "../i18n";

/** Defines a custom element once, even if the module is loaded twice under different URLs. */
export function define(name: string, element: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, element);
}

/** Dispatches the events Home Assistant listens to (`config-changed`, `hass-more-info`…). */
export function fire(node: HTMLElement, type: string, detail: unknown): void {
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/**
 * Whether an element Home Assistant shows can draw itself in Home Assistant's language now
 * (D-081): English and French always, another once its messages are loaded, the element drawn
 * again then. Its `dir` follows the language: Arabic right to left.
 */
export function inLanguage(host: ReactiveElement, hass: Speaking | undefined): boolean {
  const dir = translatorFor(hass).dir;
  if (host.dir !== dir) host.dir = dir;
  return speak(hass, () => host.requestUpdate());
}
