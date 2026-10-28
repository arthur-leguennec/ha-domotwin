import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeConfig } from "../src/config";
import { closeOnPage, ringOnPage, shownBy, updateOnPage } from "../src/components/doorbell";
import type { HomeAssistant } from "../src/ha/types";
import { Translator } from "../src/i18n";
import { RING_SHOWN_MS, type Ring } from "../src/live/doorbell";
import { NOTHING_UNSEEN } from "../src/live/privacy";

const AT = Date.parse("2026-10-28T18:00:00Z");

/** A home with one doorbell, rung at `AT`. */
function home(): HomeAssistant {
  return {
    states: {
      "event.front_bell": {
        entity_id: "event.front_bell",
        state: new Date(AT).toISOString(),
        attributes: { device_class: "doorbell", friendly_name: "Front door bell" },
      },
    },
    entities: { "event.front_bell": { entity_id: "event.front_bell" } },
    devices: {},
    areas: {},
    language: "en",
    locale: { language: "en" },
    now: () => AT,
  } as unknown as HomeAssistant;
}

const t = new Translator("en");
const ring = (at = AT): Ring => ({ entity: "event.front_bell", at });
const shown = (): Element[] => [...document.body.querySelectorAll("domotwin-doorbell")];

describe("a doorbell rung from a dashboard's card (D-087)", () => {
  afterEach(() => {
    closeOnPage();
    vi.useRealTimers();
  });

  it("is on, unless the card says not", () => {
    expect(normalizeConfig({}).doorbell).toBe(true);
    expect(normalizeConfig({ doorbell: false }).doorbell).toBe(false);
  });

  it("shows over the page once, whichever of the page's cards heard it first", () => {
    const first = {};
    const second = {};
    ringOnPage(first, home(), t, ring(), NOTHING_UNSEEN);
    expect(shown()).toHaveLength(1);
    expect(shownBy(first)).toBe(true);
    // The other card heard the same ring: not shown twice, nor taken over.
    ringOnPage(second, home(), t, ring(), NOTHING_UNSEEN);
    expect(shown()).toHaveLength(1);
    expect(shownBy(second)).toBe(false);
    // Closed: the other card does not show it again.
    closeOnPage();
    ringOnPage(second, home(), t, ring(), NOTHING_UNSEEN);
    expect(shown()).toHaveLength(0);
    // A new ring is shown, by whichever card hears it.
    ringOnPage(second, home(), t, ring(AT + 1000), NOTHING_UNSEEN);
    expect(shown()).toHaveLength(1);
    expect(shownBy(second)).toBe(true);
  });

  it("is given its card's new states, and goes with the card, not with another", () => {
    const card = {};
    const other = {};
    ringOnPage(card, home(), t, ring(AT + 2000), NOTHING_UNSEEN);
    const element = shown()[0] as Element & { hass?: HomeAssistant };
    const later = home();
    updateOnPage(other, later, NOTHING_UNSEEN);
    expect(element.hass).not.toBe(later);
    updateOnPage(card, later, NOTHING_UNSEEN);
    expect(element.hass).toBe(later);
    closeOnPage(other);
    expect(shown()).toHaveLength(1);
    closeOnPage(card);
    expect(shown()).toHaveLength(0);
  });

  it("goes after two minutes, and closes when it asks to", () => {
    vi.useFakeTimers();
    ringOnPage({}, home(), t, ring(AT + 3000), NOTHING_UNSEEN);
    vi.advanceTimersByTime(RING_SHOWN_MS - 1);
    expect(shown()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(shown()).toHaveLength(0);
    ringOnPage({}, home(), t, ring(AT + 4000), NOTHING_UNSEEN);
    shown()[0]?.dispatchEvent(new CustomEvent("domotwin-close", { bubbles: true }));
    expect(shown()).toHaveLength(0);
  });
});
