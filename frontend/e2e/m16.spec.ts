import { expect, test, type Page } from "@playwright/test";

import { entityState, openHarness, pointOn, settle } from "./fixtures";

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId("summary")).toBeVisible();
  await settle(page);
}

async function focus(page: Page, id: string): Promise<void> {
  await page.evaluate((element) => {
    (window as never as { __view: () => { showElement(id: string): boolean } })
      .__view()
      .showElement(element);
  }, id);
  await settle(page);
}

async function tap(page: Page, id: string): Promise<void> {
  const point = await pointOn(page, id);
  await page.mouse.click(point.x, point.y);
}

function calls(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as never as { __calls: Record<string, unknown>[] }).__calls);
}

/** The bindings last saved by the panel. */
function saved(page: Page): Promise<{
  rooms: Record<string, unknown>;
  elements: Record<string, Record<string, unknown>>;
}> {
  return page.evaluate(() => {
    const all = (
      window as never as { __calls: { type: string; bindings?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/bindings/save");
    return all[all.length - 1]?.bindings as never;
  });
}

test.describe("intuitive taps (D-047)", () => {
  test("a tap switches a lamp and leaves its bubble, a way to everything", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await focus(page, "living");
    await tap(page, "floor-lamp");
    await expect.poll(() => entityState(page, "light.living_room_floor_lamp")).toBe("off");
    const bubble = page.getByTestId("bubble");
    await expect(bubble).toBeVisible();
    await expect(bubble.getByRole("group", { name: "Floor lamp", exact: true })).toBeVisible();
    await bubble.getByTestId("bubble-more").click();
    await expect(
      page.locator("domotwin-controls").getByRole("dialog", { name: "Floor lamp" }),
    ).toBeVisible();
  });

  test("a tip says what a tap does, until the first one", async ({ page }) => {
    await openHarness(page, { live: true, tip: true });
    await ready(page);
    const tip = page.getByTestId("tip");
    await expect(tip).toContainText("Tap a lamp to switch it");
    await focus(page, "living");
    await tap(page, "table-lamp");
    await expect(tip).toHaveCount(0);
    // Read on this device: not again.
    expect(await page.evaluate(() => localStorage.getItem("domotwin-tip-tap"))).toBe("read");
  });

  test("a piece with nothing to switch shows its bubble, not a whole sheet", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await focus(page, "kitchen");
    await tap(page, "fridge");
    const bubble = page.getByTestId("bubble");
    await expect(bubble).toContainText("48 W");
    await expect(page.locator("domotwin-controls")).toHaveCount(0);
  });

  test("a framed room switches its lights and blinds, now or later", async ({ page }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await tap(page, "bedroom");
    const bar = page.getByTestId("room-bar");
    await expect(bar.getByTestId("room-chip")).toHaveText("Bedroom");
    await bar.getByRole("button", { name: "Lights on" }).click();
    await expect.poll(() => entityState(page, "light.bedside_right")).toBe("on");
    await expect.poll(() => entityState(page, "light.bedroom_fan_light")).toBe("on");
    await bar.getByRole("button", { name: "Close the blinds" }).click();
    await expect.poll(() => entityState(page, "cover.bedroom_curtains")).toBe("closed");
    // Its panel: the same, and its lights or blinds later.
    await bar.getByTestId("room-chip").click();
    const room = page.locator("domotwin-room");
    await expect(room.getByTestId("room-commands")).toContainText("Lights off");
    const later = room.locator("domotwin-schedules");
    await later.getByTestId("schedule-add").click();
    await later.getByTestId("schedule-group-covers").click();
    await expect(later.getByTestId("schedule-on")).toHaveText("Open");
    await later.getByTestId("schedule-at").fill("07:30");
    await later.getByTestId("schedule-save").click();
    await expect
      .poll(async () => (await calls(page)).find((c) => c.type === "domotwin/schedules/add"))
      .toMatchObject({ entities: ["cover.bedroom_curtains"], action: "on", at: "07:30" });
    await expect(later.getByTestId("schedule")).toContainText("Open");
  });
});

test.describe("links in plain words (D-047)", () => {
  test("a TV's tap is one of its plain actions; the rest is advanced", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, lang: "fr" });
    await ready(page);
    await page.getByTestId("link-mode").click();
    await focus(page, "living");
    await tap(page, "tv");
    const editor = page.locator("domotwin-link");
    const select = editor.getByTestId("link-tap");
    // Plain actions only, grouped by device; "Run an action" waits for the advanced mode.
    await expect(select.locator("optgroup")).toHaveCount(1);
    await expect(select.locator('option[value="perform-action"]')).toHaveCount(0);
    await select.selectOption({ label: "Monter le son" });
    await editor.getByTestId("link-save").click();
    await expect(editor).toHaveCount(0);
    expect((await saved(page)).elements.tv?.tap_action).toEqual({
      action: "perform-action",
      perform_action: "media_player.volume_up",
      target: { entity_id: "media_player.living_room_tv" },
    });
    // The advanced mode: any action, with its data.
    await tap(page, "tv");
    await editor.getByTestId("link-advanced").check();
    await editor.getByTestId("link-hold").selectOption("perform-action");
    await editor.getByTestId("link-hold-service").fill("media_player.volume_set");
    await editor.getByTestId("link-hold-data").fill("{volume");
    await expect(editor.getByTestId("link-save")).toBeDisabled();
    await editor.getByTestId("link-hold-data").fill('{"volume_level": 0.2}');
    await editor.getByTestId("link-hold-target").selectOption("media_player.living_room_tv");
    await editor.getByTestId("link-save").click();
    await expect(editor).toHaveCount(0);
    expect((await saved(page)).elements.tv?.hold_action).toEqual({
      action: "perform-action",
      perform_action: "media_player.volume_set",
      target: { entity_id: "media_player.living_room_tv" },
      data: { volume_level: 0.2 },
    });
    // Out of link mode, the tap turns the volume up.
    await page.getByTestId("link-mode").click();
    await tap(page, "tv");
    await expect
      .poll(async () => (await calls(page)).some((c) => c.service === "volume_up"))
      .toBe(true);
  });

  test("a room gets actions of its own, shown when it is tapped", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true });
    await ready(page);
    await page.getByTestId("link-mode").click();
    await tap(page, "living");
    const editor = page.locator("domotwin-link");
    await editor.getByTestId("room-action-add").click();
    await editor.getByTestId("room-action-name-0").fill("Evening");
    await editor.getByTestId("room-action-0").selectOption("preset:scene.living_room_evening on");
    await editor.getByTestId("link-save").click();
    await expect(editor).toHaveCount(0);
    expect((await saved(page)).rooms.living).toEqual({
      area: "living_room",
      actions: [
        {
          name: "Evening",
          action: {
            action: "perform-action",
            perform_action: "scene.turn_on",
            target: { entity_id: "scene.living_room_evening" },
          },
        },
      ],
    });
    await page.getByTestId("link-mode").click();
    // In the panel, a room tapped opens its room in the Rooms tab, with its own actions (D-055).
    await tap(page, "living");
    await page.getByTestId("room-actions").getByRole("button", { name: "Evening" }).click();
    await expect
      .poll(async () =>
        (await calls(page)).some((c) => c.domain === "scene" && c.service === "turn_on"),
      )
      .toBe(true);
  });
});
