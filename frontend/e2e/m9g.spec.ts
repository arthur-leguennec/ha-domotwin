import { expect, test, type Page } from "@playwright/test";

import { openHarness, pointOn, settle, viewState } from "./fixtures";

/** The engine's figures that private rooms change (D-039). */
interface Figures {
  closedRooms: string[] | null;
  cameraViews: unknown[];
  editing: boolean;
  camera: { target: number[] };
}

async function figures(page: Page): Promise<Figures> {
  return (await viewState(page)).stats as unknown as Figures;
}

/** The badges shown over an element, by kind. */
function badgesOf(page: Page, id: string): Promise<string[]> {
  return page
    .getByTestId("badges")
    .locator(`[data-element="${id}"] .badge`)
    .evaluateAll((spans) => spans.map((span) => span.getAttribute("data-kind") ?? ""));
}

/** `domotwin.show` (D-029), as the integration sends it to every screen. */
async function show(page: Page, request: Record<string, string>): Promise<void> {
  await page.evaluate((r) => {
    (window as never as { __show: (r: unknown) => void }).__show(r);
  }, request);
}

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

/** The settings the panel saved last. */
function savedSettings(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const calls = (
      window as never as { __calls: { type: string; settings?: unknown }[] }
    ).__calls.filter((call) => call.type === "domotwin/settings/save");
    return calls[calls.length - 1]?.settings;
  });
}

test.describe("private rooms (D-039)", () => {
  test("a private room is drawn closed: nothing in it, nobody shown, taps do nothing", async ({
    page,
  }) => {
    await openHarness(page, { live: true, people: true, private: ["living"] });
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual(["living"]);
    await settle(page);
    // Its camera's view and its pieces' badges are gone; the others' stay.
    expect((await figures(page)).cameraViews).toEqual([]);
    await expect.poll(() => badgesOf(page, "door-entrance")).toEqual(["unlocked"]);
    expect(await badgesOf(page, "tv")).toEqual([]);
    expect(await badgesOf(page, "bookcase")).toEqual([]);
    // Its name, with a lock.
    const name = page.getByTestId("room-names").locator('[data-room="living"]');
    await expect(name).toHaveAttribute("data-private", "");
    // Sam, in it, is not drawn; Alex, in the kitchen, is.
    const people = page.getByTestId("people");
    await expect(people.locator('[data-person="person.alex"]')).toHaveCount(1);
    await expect(people.locator('[data-person="person.sam"]')).toHaveCount(0);
    // `domotwin.show` frames neither it nor anything in it on this screen; another room, yes.
    const before = (await figures(page)).camera.target;
    await show(page, { element: "sofa" });
    await show(page, { element: "living" });
    await settle(page);
    expect((await figures(page)).camera.target).toEqual(before);
    await show(page, { element: "kitchen" });
    await expect.poll(async () => (await figures(page)).camera.target).not.toEqual(before);
    await show(page, { view: "overview" });
    await settle(page);
    // A tap on its floor does nothing (no room framed); a long press says it is private.
    const floor = await pointOn(page, "living");
    await page.mouse.click(floor.x, floor.y);
    await expect(page.getByTestId("room-chip")).toHaveCount(0);
    await longPress(page, floor);
    await expect(page.getByTestId("room").getByTestId("room-private")).toBeVisible();
  });

  test("the home is not shown before its settings are read", async ({ page }) => {
    await openHarness(page, { live: true, private: ["living"], settingsDown: true });
    // Its private rooms not known: no plan drawn, not even for a moment.
    const view = page.locator("domotwin-view");
    await expect(view.getByText("Loading DomoTwin…")).toBeVisible();
    await page.waitForTimeout(500);
    expect((await viewState(page)).summary).toBeUndefined();
    await page.evaluate(() => {
      (window as never as { __settingsUp: () => void }).__settingsUp();
    });
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual(["living"]);
  });

  test("kept for the user viewing, or private only while an entity is on", async ({ page }) => {
    // Kept for Alex, the user viewing: open to them.
    await openHarness(page, {
      live: true,
      people: true,
      private: ["living"],
      privateFor: "person.alex",
    });
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual([]);
    await expect.poll(() => badgesOf(page, "tv")).toEqual(["playing"]);

    // Private while guests are here: closed when the switch is on, open again when it is off.
    await openHarness(page, {
      live: true,
      private: ["living", "bedroom"],
      privateWhile: "input_boolean.guests",
    });
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual(["bedroom", "living"]);
    await page.evaluate(() => {
      (window as never as { __setState: (id: string, state: string) => void }).__setState(
        "input_boolean.guests",
        "off",
      );
    });
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual([]);
    await page.evaluate(() => {
      (window as never as { __setState: (id: string, state: string) => void }).__setState(
        "input_boolean.guests",
        "on",
      );
    });
    await expect.poll(async () => (await figures(page)).closedRooms).toHaveLength(2);
  });

  test("set in the panel; administrators still see everything while editing", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true });
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual([]);
    await page.getByTestId("privacy-settings").click();
    const dialog = page.getByTestId("private-rooms-dialog");
    await expect(dialog.getByTestId("privacy-limit")).toBeVisible();
    const bedroom = dialog.locator('[data-room="bedroom"]');
    await bedroom.getByTestId("room-access").selectOption("private");
    await bedroom.locator('[data-person="person.sam"]').check();
    // While an entity is on, it must be named.
    await bedroom.getByTestId("room-when").selectOption("while");
    await dialog.getByTestId("privacy-save").click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await bedroom.getByTestId("room-while").fill("input_boolean.guests");
    await bedroom.getByTestId("room-while").dispatchEvent("change");
    await dialog.getByTestId("privacy-save").click();
    await expect(dialog).toHaveCount(0);
    expect(await savedSettings(page)).toEqual({
      rooms: { bedroom: { people: ["person.sam"], while: "input_boolean.guests" } },
    });
    // The guests' switch is not known: the bedroom is closed (the administrator is not Sam).
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual(["bedroom"]);
    // Edit mode: everything, to change the home.
    await page.getByTestId("edit-mode").click();
    await expect.poll(async () => (await figures(page)).closedRooms).toEqual([]);
  });
});
