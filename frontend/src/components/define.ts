import type { ReactiveElement } from "lit";

import { directionFor, languageOf, languageReady, loadLanguage, type Speaking } from "../i18n";

/** Defines a custom element once, even if the module is loaded twice under different URLs. */
export function define(name: string, element: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, element);
}

/** Dispatches the events Home Assistant listens to (`config-changed`, `hass-more-info`…). */
export function fire(node: HTMLElement, type: string, detail: unknown): void {
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/**
 * An update of an element Home Assistant shows (its `scheduleUpdate`), once DomoTwin speaks Home
 * Assistant's language (D-081): at once in English and French, once its messages are loaded in
 * another. Meanwhile the element shows what it showed, and its `updateComplete` waits too. It
 * turns the way the language is written: Arabic right to left.
 */
export function inLanguage(
  host: ReactiveElement,
  hass: () => Speaking | undefined,
  update: () => unknown,
): Promise<unknown> | undefined {
  const draw = (): unknown => {
    const dir = directionFor(hass());
    if (host.dir !== dir) host.dir = dir;
    return update();
  };
  if (languageReady(languageOf(hass()))) {
    const drawn = draw();
    return drawn instanceof Promise ? drawn : undefined;
  }
  return (async () => {
    // Its language may change again while one loads.
    for (
      let language = languageOf(hass());
      !languageReady(language);
      language = languageOf(hass())
    ) {
      await loadLanguage(language);
    }
    await draw();
  })();
}
