/** Defines a custom element once, even if the module is loaded twice under different URLs. */
export function define(name: string, element: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, element);
}

/** Dispatches the events Home Assistant listens to (`config-changed`, `hass-more-info`…). */
export function fire(node: HTMLElement, type: string, detail: unknown): void {
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
