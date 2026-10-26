/**
 * A home kept in the page shown in place of the home, for the panel and the card alike: the demo
 * house (D-050) or the sandbox (D-057). Its Home Assistant swapped in and out, its day held while
 * they are away, Home Assistant's own dialogs kept out of it. Each is a module loaded the first
 * time it is asked for.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { DemoHome } from "../demo/home";
import type { SandboxHome } from "../sandbox/home";
import type { HomeAssistant } from "../ha/types";
import { clearDemoDrafts } from "../live/draft";

/** The panel or the card showing the demo house. */
export interface DemoHost extends ReactiveControllerHost, HTMLElement {
  /** Shows a home's Home Assistant: the demo house's, or the visitor's own again. */
  showHome(hass: HomeAssistant | undefined): void;
  /** The demo house's `hass`, new at each change of its day. */
  demoChanged(hass: HomeAssistant): void;
}

/** A home kept in the page. */
export type InPageHome = DemoHome | SandboxHome;

export class DemoSwitch implements ReactiveController {
  /** The home kept in the page shown, if one is. */
  home?: InPageHome;
  /** The visitor's own Home Assistant, kept while the demo is shown. */
  realHass?: HomeAssistant;
  private unsubscribe?: () => void;
  private starting = false;

  constructor(private readonly host: DemoHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this.home?.away(false);
    this.host.addEventListener("hass-more-info", this.keepIn);
  }

  hostDisconnected(): void {
    // Its day held while the panel or the card is away.
    this.home?.away(true);
    this.host.removeEventListener("hass-more-info", this.keepIn);
  }

  /** Home Assistant's own dialogs show the home's entities, not the demo house's. */
  private readonly keepIn = (event: Event): void => {
    if (this.home) event.stopPropagation();
  };

  /** Shows the demo house, once its module is loaded, if `allowed` still says so then. */
  async start(allowed: () => boolean): Promise<void> {
    await this.show(allowed, async () => {
      const { DemoHome } = await import("../demo/demo-bar");
      const real = this.realHass;
      return new DemoHome({
        language: real?.locale?.language ?? real?.language ?? "en",
        ...(real?.user?.name ? { name: real.user.name } : {}),
        darkMode: real?.themes?.darkMode === true,
      });
    });
  }

  /** Shows the home `make` gives, if `allowed` still says so once it has it. */
  async show(allowed: () => boolean, make: () => Promise<InPageHome>): Promise<void> {
    if (this.home || this.starting || !allowed()) return;
    this.starting = true;
    const home = await make().finally(() => {
      this.starting = false;
    });
    // Only this start shows one (`starting`); what it waited for may no longer be so.
    if (!allowed()) {
      home.stop();
      return;
    }
    // Its edits are gone once left: none kept from a visit before.
    clearDemoDrafts();
    this.home = home;
    this.unsubscribe = home.subscribe((hass) => {
      this.host.demoChanged(hass);
    });
    this.host.showHome(home.hass);
    home.away(!this.host.isConnected);
    // The demo house's day goes on by itself; the sandbox's waits to be played.
    home.play(home.kind === "demo");
  }

  /** Back to the home. */
  stop(): void {
    const home = this.home;
    if (!home) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    home.stop();
    this.home = undefined;
    clearDemoDrafts();
    this.host.showHome(this.realHass);
  }
}
