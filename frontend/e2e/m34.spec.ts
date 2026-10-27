import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, pointOn, settle, viewState } from "./fixtures";

/**
 * Alex (the user viewing, not an administrator) only looks at the living room but uses its floor
 * lamp, and does not see the TV; the bedroom is hidden from everyone.
 */
const RIGHTS = {
  everyone: { rooms: { bedroom: "hidden" } },
  people: {
    "person.alex": {
      rooms: { living: "see" },
      entities: {
        "light.living_room_floor_lamp": "use",
        "media_player.living_room_tv": "hidden",
      },
    },
  },
};

async function closedRooms(page: Page): Promise<unknown> {
  return ((await viewState(page)).stats as unknown as { closedRooms: string[] | null }).closedRooms;
}

/** The badges shown over an element, by kind. */
function badgesOf(page: Page, id: string): Promise<string[]> {
  return page
    .getByTestId("badges")
    .locator(`[data-element="${id}"] .badge`)
    .evaluateAll((spans) => spans.map((span) => span.getAttribute("data-kind") ?? ""));
}

/** The services called on Home Assistant so far. */
function serviceCalls(page: Page): Promise<{ service: string; target?: unknown }[]> {
  return page.evaluate(() =>
    (
      window as never as { __calls: { type: string; service: string; target?: unknown }[] }
    ).__calls.filter((call) => call.type === "call_service"),
  );
}

/** The settings saved last. */
function savedSettings(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const calls = (
      window as never as { __calls: { type: string; settings?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/settings/save");
    return calls[calls.length - 1]?.settings;
  });
}

test.describe("per-person rights (D-070)", () => {
  test("someone who only looks: their room's controls disabled, a device unlinked, a room closed", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      admin: false,
      live: true,
      people: true,
      rights: RIGHTS,
      cards: true,
    });
    // The bedroom, hidden from everyone, is closed as a private room is.
    await expect.poll(() => closedRooms(page)).toEqual(["bedroom"]);
    await settle(page);
    // The TV, hidden from Alex, is no longer linked: no badge; the entrance's lock still is.
    await expect.poll(() => badgesOf(page, "door-entrance")).toEqual(["unlocked"]);
    expect(await badgesOf(page, "tv")).toEqual([]);

    // A tap on the pendant, only looked at: DomoTwin's own panel, its controls disabled, nothing
    // asked of Home Assistant.
    const pendant = await pointOn(page, "pendant-living");
    await page.mouse.click(pendant.x, pendant.y);
    const controls = page.getByTestId("controls");
    await expect(controls).toBeVisible();
    const looked = controls.locator("fieldset.look");
    await expect(looked).toHaveAttribute("disabled", "");
    await expect(looked.locator("button.switch")).toBeDisabled();
    await expect(looked).toHaveAttribute("title", "You may look at this device, not use it.");
    await expect(controls.getByTestId("schedule-add")).toHaveCount(0);
    await expect(controls.getByText("More info")).toHaveCount(0);
    expect(await serviceCalls(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);

    // The floor lamp, Alex's to use: switched.
    const lamp = await pointOn(page, "floor-lamp");
    await page.mouse.click(lamp.x, lamp.y);
    await expect.poll(async () => (await serviceCalls(page)).length).toBe(1);
    expect((await serviceCalls(page))[0]?.target).toEqual({
      entity_id: "light.living_room_floor_lamp",
    });

    // The living room's panel: its lights listed, to look at but the floor lamp; no TV.
    const floor = await pointOn(page, "living");
    await page.mouse.move(floor.x, floor.y);
    await page.mouse.down();
    await page.waitForTimeout(750);
    await page.mouse.up();
    const panel = page.getByTestId("room");
    await expect(panel.locator('.row[aria-label="Living room pendant"]')).toBeVisible();
    await expect(panel.locator('fieldset.look .row[aria-label="Living room pendant"]')).toHaveCount(
      1,
    );
    await expect(panel.locator('.row[aria-label="Living room floor lamp"]')).toBeVisible();
    await expect(
      panel.locator('fieldset.look .row[aria-label="Living room floor lamp"]'),
    ).toHaveCount(0);
    await expect(panel.locator('.row[aria-label="Living room tv"]')).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The Rooms tab: the bedroom closed, as a private room is; the living room's pendant a card to
    // look at; the TV not there.
    await page.getByTestId("tab-rooms").click();
    const list = page.getByTestId("rooms-list");
    await expect(list.locator("button[data-area='living_room']")).toBeVisible();
    await expect(list.locator("button[data-area='bedroom']")).toContainText("Private room");
    await list.locator("button[data-area='living_room']").click();
    const room = page.getByTestId("room-page");
    const tile = room.locator(".entity[data-entity='light.living_room_pendant'] .ha-card");
    await expect(tile).toHaveAttribute("data-type", "tile");
    expect(JSON.parse((await tile.getAttribute("data-config")) ?? "{}")).toMatchObject({
      tap_action: { action: "none" },
      hold_action: { action: "none" },
      icon_tap_action: { action: "none" },
    });
    const usable = room.locator(".entity[data-entity='light.living_room_floor_lamp'] .ha-card");
    expect(JSON.parse((await usable.getAttribute("data-config")) ?? "{}")).toEqual({
      type: "tile",
      entity: "light.living_room_floor_lamp",
    });
    await expect(room.locator(".entity[data-entity='media_player.living_room_tv']")).toHaveCount(0);
  });

  test("an administrator sees everything, and sets the rights in one place", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      people: true,
      rights: { everyone: { rooms: { kitchen: "see" } } },
    });
    // Rights are not an administrator's.
    await expect.poll(() => closedRooms(page)).toEqual([]);
    await fromMenu(page, "rights-menu");
    const dialog = page.getByTestId("rights-dialog");
    await expect(dialog.getByTestId("rights-limit")).toContainText("not behind a security barrier");
    await expect(dialog.getByTestId("rights-summary")).toHaveText(
      "Of 5 rooms: uses 4, only sees 1, does not see 0. 0 devices set apart.",
    );
    // Everyone: the bedroom hidden.
    await dialog.locator('[data-room="bedroom"]').getByTestId("room-level").selectOption("hidden");
    await expect(dialog.getByTestId("rights-summary")).toContainText("does not see 1");

    // Alex, the administrator viewing: said so.
    await dialog.getByTestId("rights-for").selectOption("person.alex");
    await expect(dialog.getByTestId("rights-who")).toContainText("An administrator");
    // Sam, with no user yet: their own, from everyone's.
    await dialog.getByTestId("rights-for").selectOption("person.sam");
    await expect(dialog.getByTestId("rights-who")).toContainText("No Home Assistant user");
    const bedroom = dialog.locator('[data-room="bedroom"]').getByTestId("room-level");
    await expect(bedroom.locator("option:checked")).toHaveText("As it is (Does not see)");
    await bedroom.selectOption("use");
    const living = dialog.locator('[data-room="living"]');
    await living.getByTestId("room-level").selectOption("see");
    await living.locator("summary").click();
    const lamp = living
      .locator('[data-entity="light.living_room_floor_lamp"]')
      .getByTestId("device-level");
    await expect(lamp.locator("option:checked")).toHaveText("As it is (Only sees)");
    await lamp.selectOption("use");
    // Everyone's, then Sam's again: each select shows what is set.
    await dialog.getByTestId("rights-for").selectOption("");
    await expect(living.getByTestId("room-level").locator("option:checked")).toHaveText("Uses");
    await dialog.getByTestId("rights-for").selectOption("person.sam");
    await expect(living.getByTestId("room-level").locator("option:checked")).toHaveText(
      "Only sees",
    );
    await living.locator("summary").click();
    await expect(lamp.locator("option:checked")).toHaveText("Uses");
    // A scene in no room, only looked at.
    await dialog.getByTestId("rights-extra").fill("scene.movie_night");
    await dialog.getByTestId("rights-add").click();
    await expect(dialog.locator('[data-entity="scene.movie_night"]')).toBeVisible();
    await dialog.getByTestId("rights-extra").fill("not an entity");
    await dialog.getByTestId("rights-add").click();
    await expect(dialog.getByRole("alert")).toHaveText("“not an entity” is not an entity id.");
    await expect(dialog.getByTestId("rights-summary")).toHaveText(
      "Of 5 rooms: uses 3, only sees 2, does not see 0. 2 devices set apart.",
    );
    await dialog.getByTestId("rights-save").click();
    await expect(dialog).toHaveCount(0);
    expect(await savedSettings(page)).toEqual({
      rights: {
        everyone: { rooms: { kitchen: "see", bedroom: "hidden" } },
        people: {
          "person.sam": {
            rooms: { bedroom: "use", living: "see" },
            entities: {
              "light.living_room_floor_lamp": "use",
              "scene.movie_night": "see",
            },
          },
        },
      },
    });
    // Still everything for the administrator.
    await expect.poll(() => closedRooms(page)).toEqual([]);
  });

  test("in French", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, lang: "fr" });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("rights-menu")).toContainText("Droits");
    await page.getByTestId("rights-menu").click();
    const dialog = page.getByTestId("rights-dialog");
    await expect(dialog.locator("h2")).toHaveText("Droits");
    await expect(dialog.getByTestId("rights-summary")).toHaveText(
      "Sur 5 pièces : se sert de 5, en voit seulement 0, n’en voit pas 0. 0 appareil à part.",
    );
  });

  test("on a dashboard card too", async ({ page }) => {
    await openHarness(page, { admin: false, live: true, people: true, rights: RIGHTS });
    await expect.poll(() => closedRooms(page)).toEqual(["bedroom"]);
    await settle(page);
    await expect.poll(() => badgesOf(page, "door-entrance")).toEqual(["unlocked"]);
    expect(await badgesOf(page, "tv")).toEqual([]);
  });
});
