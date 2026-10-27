import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

const ROOT = join(import.meta.dirname, "../..");
const TOKEN = "fictional-guest-link-secret-0123456789abcdefghij";
const LINK = `/api/domotwin/guest/${TOKEN}`;

/** The hosts the page asked something of, other than the test server. */
function elsewhere(page: Page): string[] {
  const hosts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol.startsWith("http")) {
      hosts.push(url.hostname);
    }
  });
  return hosts;
}

/** What the page's policy refused, and its errors. */
function problems(page: Page): string[] {
  const found: string[] = [];
  page.on("pageerror", (error) => found.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Refused/.test(message.text())) {
      found.push(message.text());
    }
  });
  return found;
}

const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}) => ({
  entity_id,
  state: value,
  attributes,
  last_changed: "2026-01-15T08:00:00+00:00",
  last_updated: "2026-01-15T08:00:00+00:00",
});

/**
 * What the integration answers through a pass of the fictional demo apartment: the living room
 * open, the other rooms closed, emptied and unnamed (`guests.py`, `guest_home`).
 */
function snapshot(change: { act?: boolean; storeys?: boolean } = {}): Record<string, unknown> {
  const plan = JSON.parse(
    readFileSync(join(ROOT, "examples/demo-apartment.domotwin.json"), "utf8"),
  ) as {
    name: string;
    rooms: { id: string; name: string }[];
    items: { room?: string }[];
    views?: unknown;
  };
  plan.name = "";
  delete plan.views;
  plan.items = plan.items.filter((item) => item.room === "living");
  for (const room of plan.rooms) if (room.id !== "living") room.name = "";
  return {
    pass: {
      name: "Sam and Lee",
      starts: "2026-01-15T08:00:00+00:00",
      ends: "2099-01-17T08:00:00+00:00",
      act: change.act ?? true,
      entities: ["light.living_room_pendant", "media_player.living_room_tv", "lock.entrance_door"],
    },
    home: "Fictional home",
    storeys:
      change.storeys === false
        ? []
        : [{ info: { id: "storey-1", name: "", elevation: 0 }, plan, layout: {} }],
    bindings: {
      version: 1,
      rooms: { living: { area: "living_room" } },
      elements: {
        "pendant-living": {
          entities: [{ entity_id: "light.living_room_pendant" }],
          tap_action: { action: "toggle" },
        },
        tv: { entities: [{ entity_id: "media_player.living_room_tv" }] },
      },
    },
    settings: {
      rooms: Object.fromEntries(
        ["kitchen", "bathroom", "hall", "bedroom"].map((room) => [room, { people: [] }]),
      ),
    },
    states: {
      "light.living_room_pendant": state("light.living_room_pendant", "off", {
        friendly_name: "Pendant",
        supported_color_modes: ["brightness"],
      }),
      "media_player.living_room_tv": state("media_player.living_room_tv", "off", {
        friendly_name: "TV",
      }),
      "lock.entrance_door": state("lock.entrance_door", "locked", {
        friendly_name: "Entrance door",
      }),
    },
    entities: {},
    areas: { living_room: { area_id: "living_room", name: "Living room" } },
    wifi: {
      name: "Fictional Guests",
      password: "tea-and-cake-42",
      security: "WPA",
      hidden: false,
    },
    config: { time_zone: "UTC", unit_system: { temperature: "°C" } },
  };
}

/** An event the pass's page follows, as `Guests.async_stream` writes it. */
const sse = (name: string, data: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

interface Pass {
  /** What `…/home` answers next: the home, or a refusal and its status. */
  home: { status: number; body: unknown };
  /** What each new `…/events` sends, in turn (the last one again after them). */
  events: string[];
  /** What `…/call` was asked, and answers. */
  calls: unknown[];
  call: { status: number; body: unknown };
}

/** Answers what the guest's page asks through the pass, as the integration would. */
async function pass(page: Page, home: unknown = snapshot()): Promise<Pass> {
  const answers: Pass = {
    home: { status: 200, body: home },
    // Followed: the states as they are; reconnecting quickly in the tests.
    events: ["retry: 300\n\n"],
    calls: [],
    call: { status: 200, body: { done: true } },
  };
  let followed = 0;
  await page.route(`**${LINK}/home`, (route: Route) =>
    route.fulfill({ status: answers.home.status, json: answers.home.body }),
  );
  await page.route(`**${LINK}/events`, (route: Route) => {
    const body = answers.events[Math.min(followed, answers.events.length - 1)] ?? "";
    followed += 1;
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body,
    });
  });
  await page.route(`**${LINK}/call`, (route: Route) => {
    answers.calls.push(route.request().postDataJSON());
    return route.fulfill({ status: answers.call.status, json: answers.call.body });
  });
  return answers;
}

const guestPage = (page: Page): Locator => page.locator("domotwin-guest");

/** The 3D view of the guest's card, once drawn. */
async function viewSummary(page: Page): Promise<{ rooms: number } | undefined> {
  return page.evaluate(() => {
    const view = document
      .querySelector("domotwin-guest")
      ?.shadowRoot?.querySelector("domotwin-card")
      ?.shadowRoot?.querySelector("domotwin-view") as
      (HTMLElement & { debugState(): { summary?: { rooms: number } } }) | null;
    return view?.debugState().summary;
  });
}

test.describe("guest access (D-067)", () => {
  test("an administrator makes a pass, sees its link and code, changes, renews and removes it", async ({
    page,
  }) => {
    const hosts = elsewhere(page);
    await openHarness(page, { mode: "panel", live: true });
    await fromMenu(page, "guests-menu");
    const dialog = page.getByTestId("guests-dialog");
    await expect(dialog.getByTestId("guests-none")).toBeVisible();
    await dialog.getByTestId("guests-add").click();
    await expect(dialog).toContainText("A pass's link is its key");
    // Nobody named yet: refused here.
    await dialog.getByTestId("guest-save").click();
    await expect(dialog.getByRole("alert")).toContainText("Say who the pass is for.");
    await dialog.getByTestId("guest-name").fill("Sam and Lee");
    // The living room's devices, ticked; the hall's lock left to a tick.
    await dialog.getByTestId("guest-room-living").check();
    await expect(dialog.getByTestId("guest-device-light.living_room_pendant")).toBeChecked();
    await expect(dialog.getByTestId("guest-device-media_player.living_room_tv")).toBeChecked();
    await expect(dialog.getByTestId("guest-device-camera.living_room")).toHaveCount(0);
    await dialog.getByTestId("guest-room-hall").check();
    await expect(dialog.getByTestId("guest-device-lock.entrance_door")).not.toBeChecked();
    await dialog.getByTestId("guest-device-light.living_room_floor_lamp").uncheck();
    // No Wi-Fi given: none to show.
    await expect(dialog.getByTestId("guest-wifi")).toBeDisabled();
    await dialog.getByTestId("guest-save").click();
    // Its link and its code.
    await expect(dialog.getByTestId("guest-code")).toBeVisible();
    const link = await dialog.getByTestId("guest-link").inputValue();
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:4173\/api\/domotwin\/guest\/fictional0+1$/);
    const saved = await page.evaluate(
      () => (window as never as { __guestsSaved: Record<string, unknown>[] }).__guestsSaved,
    );
    const made = saved.at(-1);
    expect(made).toMatchObject({
      name: "Sam and Lee",
      rooms: ["living", "hall"],
      act: true,
      wifi: false,
      anywhere: false,
    });
    const entities = made?.entities as string[];
    expect(entities).toContain("light.living_room_pendant");
    expect(entities).toContain("light.hall_spots");
    expect(entities).not.toContain("lock.entrance_door");
    expect(entities).not.toContain("light.living_room_floor_lamp");
    expect(entities.some((id) => id.startsWith("camera."))).toBe(false);
    // Only to look, from now on.
    await dialog.getByTestId("guest-edit").click();
    await dialog.getByTestId("guest-act").uncheck();
    await dialog.getByTestId("guest-save").click();
    await expect(dialog.getByTestId("guest-summary")).toContainText("To look only");
    expect(await dialog.getByTestId("guest-link").inputValue()).toBe(link);
    // A new link: the old one opens nothing.
    await dialog.getByTestId("guest-renew").click();
    await expect(dialog).toContainText("A new link: the old one no longer opens anything.");
    expect(await dialog.getByTestId("guest-link").inputValue()).not.toBe(link);
    // Back to the list, then removed.
    await dialog.getByTestId("guests-back").click();
    await expect(dialog.getByTestId("guest-pass")).toHaveCount(1);
    await expect(dialog.getByTestId("guest-pass")).toContainText("Sam and Lee");
    await dialog.getByTestId("guest-pass").click();
    page.once("dialog", (asked) => void asked.accept());
    await dialog.getByTestId("guest-remove").click();
    await expect(dialog.getByTestId("guests-none")).toBeVisible();
    expect(hosts).toEqual([]);
  });

  test("a guest opens the rooms and devices of their pass, and uses them", async ({ page }) => {
    const hosts = elsewhere(page);
    const found = problems(page);
    const answers = await pass(page);
    await page.goto(LINK);
    const guest = guestPage(page);
    await expect(guest.getByTestId("guest-home")).toHaveText("Fictional home");
    await expect(guest.getByTestId("guest-pass")).toContainText("Sam and Lee, until");
    // The home in 3D, the rooms it does not open closed.
    await expect.poll(() => viewSummary(page), { timeout: 30_000 }).toMatchObject({ rooms: 5 });
    // Its devices, room by room; the lock of the hall, which it does not open, apart.
    const devices = guest.getByTestId("guest-devices");
    await expect(devices).toContainText("Your devices");
    await expect(devices.locator("h3")).toHaveText(["Living room", "Elsewhere"]);
    await expect(devices).toContainText("Pendant");
    await expect(devices).toContainText("Entrance door");
    // Used: through the pass.
    await devices.getByRole("switch", { name: "Pendant" }).click();
    await expect
      .poll(() => answers.calls)
      .toEqual([
        {
          domain: "homeassistant",
          service: "turn_on",
          data: {},
          target: { entity_id: "light.living_room_pendant" },
        },
      ]);
    // The pendant on, as the pass's page is told.
    answers.events.push(
      sse("state", state("light.living_room_pendant", "on", { friendly_name: "Pendant" })),
    );
    await expect(devices.getByRole("switch", { name: "Pendant" })).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 10_000 },
    );
    expect(found).toEqual([]);
    expect(hosts).toEqual([]);
  });

  test("a pass to look only, and what a refusal says", async ({ page }) => {
    const answers = await pass(page, snapshot({ act: false }));
    answers.call = { status: 403, body: { code: "look_only" } };
    await page.goto(LINK);
    const guest = guestPage(page);
    await expect(guest.getByTestId("guest-look-only")).toHaveText(
      "This pass lets you look, not use.",
    );
    await expect(
      guest.getByTestId("guest-devices").getByRole("switch", { name: "Pendant" }),
    ).toBeDisabled();
  });

  test("a pass not open from here, ended or removed says why", async ({ page }) => {
    const answers = await pass(page);
    answers.home = { status: 403, body: { code: "home_only" } };
    await page.goto(LINK);
    const refused = guestPage(page).getByTestId("guest-refused");
    await expect(refused).toContainText("This pass opens only on the home's Wi-Fi.");
    // Joined the Wi-Fi: asked again, it opens.
    answers.home = { status: 200, body: snapshot() };
    await refused.getByRole("button", { name: "Try again" }).click();
    await expect(guestPage(page).getByTestId("guest-home")).toHaveText("Fictional home");
    // Ended: said when, nothing to try again.
    answers.home = { status: 410, body: { code: "ended", ends: "2026-01-17T08:00:00+00:00" } };
    await page.reload();
    await expect(refused).toContainText("This pass ended on Jan 17, 2026");
    await expect(refused.getByRole("button")).toHaveCount(0);
    answers.home = { status: 404, body: { code: "unknown" } };
    await page.reload();
    await expect(refused).toContainText("This link opens nothing");
  });

  test("the home's Wi-Fi on a pass that opens no room", async ({ page }) => {
    await pass(page, snapshot({ storeys: false }));
    await page.goto(LINK);
    const guest = guestPage(page);
    await expect(guest.locator("domotwin-card")).toHaveCount(0);
    await guest.getByTestId("guest-wifi").click();
    await expect(guest.getByTestId("wifi-code")).toBeVisible();
    await expect(guest.getByTestId("wifi-name")).toHaveText("Fictional Guests");
  });
});

test.describe("guest access in French (D-067)", () => {
  test.use({ locale: "fr-FR" });

  test("the guest's page speaks the guest's language", async ({ page }) => {
    const answers = await pass(page);
    answers.home = { status: 403, body: { code: "not_yet", starts: "2099-01-15T08:00:00+00:00" } };
    await page.goto(LINK);
    await expect(guestPage(page).getByTestId("guest-refused")).toContainText(
      "Ce pass s’ouvre le 15 janv. 2099",
    );
    answers.home = { status: 200, body: snapshot() };
    await page.reload();
    await expect(guestPage(page).getByTestId("guest-devices")).toContainText("Vos appareils");
    await expect(guestPage(page).getByTestId("guest-pass")).toContainText("Sam and Lee, jusqu’au");
  });
});
