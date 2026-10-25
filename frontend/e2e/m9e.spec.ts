import { expect, test, type Page } from "@playwright/test";

import { canvasPng, openHarness, settle } from "./fixtures";

/** The messages of a type the frontend sent to the mocked Home Assistant. */
function sent(page: Page, type: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (type) =>
      (window as never as { __calls: { type: string }[] }).__calls.filter(
        (call) => call.type === type,
      ) as Record<string, unknown>[],
    type,
  );
}

/** Moves a fictional person (their room sensor, as the integration writes it; null: away). */
async function move(page: Page, person: string, room: string | null): Promise<void> {
  await page.evaluate(
    ({ person, room }) => {
      (window as never as { __move(p: string, r: string | null): void }).__move(person, room);
    },
    { person, room },
  );
}

/** Where a person's name is drawn (CSS pixels). */
function tagAt(page: Page, person: string): Promise<{ x: number; y: number } | null> {
  return page
    .locator(`[data-testid="people"] [data-person="${person}"]`)
    .boundingBox()
    .then((box) => (box ? { x: box.x, y: box.y } : null));
}

test.describe("people in their rooms (D-034)", () => {
  test("people stand in their rooms, named; a tap opens their sheet", async ({ page }) => {
    await openHarness(page, { live: true, people: true });
    await settle(page);
    const people = page.getByTestId("people");
    // Alex in the kitchen, Sam in the living room; Kim is away.
    await expect(people.locator(".person-tag")).toHaveCount(2);
    const alex = people.locator('[data-person="person.alex"]');
    await expect(alex).toHaveAttribute("aria-label", "Alex Martin: In the Kitchen");
    await expect(alex).toContainText("Alex");
    await expect(people.locator('[data-person="person.kim"]')).toHaveCount(0);
    await alex.click();
    const sheet = page.getByTestId("person");
    await expect(sheet).toContainText("In the Kitchen");
    await expect(sheet).toContainText("Placed by Alex's phone area");
    await expect(sheet).toContainText("Since");
    // Alex is the user viewing: they can hide themselves.
    await expect(sheet.getByTestId("person-hide")).toHaveText(/Hide me/);
    // The room's panel says who is there.
    await sheet.getByTestId("person-room").click();
    const room = page.getByTestId("room");
    await expect(room.getByTestId("room-people")).toContainText("Alex Martin");
    await room.getByTestId("room-people").getByRole("button", { name: "Alex Martin" }).click();
    await expect(page.getByTestId("person")).toBeVisible();
  });

  test("someone walks to another room through the doors", async ({ page }) => {
    await openHarness(page, { live: true, people: true });
    await settle(page);
    const before = await tagAt(page, "person.alex");
    expect(before).not.toBeNull();
    await move(page, "person.alex", "bedroom");
    const alex = page.locator('[data-testid="people"] [data-person="person.alex"]');
    await expect(alex).toHaveAttribute("aria-label", "Alex Martin: In the Bedroom");
    // It walks there (its name follows it).
    await expect
      .poll(
        async () => {
          const at = await tagAt(page, "person.alex");
          return at && before ? Math.hypot(at.x - before.x, at.y - before.y) : 0;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(60);
    // Away: gone from the home.
    await move(page, "person.alex", null);
    await expect(alex).toHaveCount(0);
  });

  test("people hide themselves", async ({ page }) => {
    await openHarness(page, { live: true, people: true });
    await settle(page);
    await page.locator('[data-testid="people"] [data-person="person.alex"]').click();
    await page.getByTestId("person").getByTestId("person-hide").click();
    expect(await sent(page, "domotwin/people/hide")).toEqual([
      { type: "domotwin/people/hide", person: "person.alex", hidden: true },
    ]);
    const alex = page.locator('[data-testid="people"] [data-person="person.alex"]');
    await expect(alex).toHaveCount(0);
    // From the layer menu, Alex shows themselves again.
    await page.getByTestId("layers").click();
    await page.getByTestId("show-me").click();
    await expect(alex).toHaveCount(1);
  });

  test("shown to administrators only, others see nobody", async ({ page }) => {
    await openHarness(page, { live: true, people: true, peopleShown: "admins", admin: false });
    await settle(page);
    await expect(page.locator(".person-tag")).toHaveCount(0);
  });

  test("a card without people, and the storeys' counts", async ({ page }) => {
    await openHarness(page, { live: true, people: true, storeys: 2 });
    await settle(page);
    const ground = page.locator('[data-testid="storeys"] [data-storey="storey-1"]');
    await expect(ground.locator(".people-count")).toHaveText("2");
    await expect(ground).toHaveAttribute("aria-label", /2 people on this storey/);
    await page.evaluate(() => {
      const view = (window as never as { __view: () => { options: object } }).__view();
      view.options = { ...view.options, people: false };
    });
    await expect(page.locator(".person-tag")).toHaveCount(0);
    await expect(ground.locator(".people-count")).toHaveCount(0);
  });

  test("administrators place people from what says where they are", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true });
    await settle(page);
    await page.getByTestId("people-settings").click();
    const dialog = page.getByTestId("people-settings-dialog");
    const alex = dialog.locator('[data-person="person.alex"]');
    await expect(alex.locator('[data-source="sensor.alex_phone_area"]')).toBeVisible();
    // The watch Home Assistant knows is Alex's: suggested.
    await alex.locator('[data-suggested="sensor.alex_watch_area"]').click();
    await alex.getByTestId("person-source").fill("not an entity");
    await alex.getByTestId("person-source").dispatchEvent("change");
    await expect(dialog.getByRole("alert")).toContainText("not an entity id");
    // Kim no longer shown; only administrators see the people, drawn as pins.
    await dialog.locator('[data-person="person.kim"]').getByTestId("person-placed").uncheck();
    await dialog.getByTestId("people-shown").selectOption("admins");
    await dialog.getByTestId("people-look").selectOption("pin");
    await dialog.getByTestId("people-save").click();
    await expect(dialog).toHaveCount(0);
    const saves = await sent(page, "domotwin/people/save");
    expect(saves.at(-1)).toEqual({
      type: "domotwin/people/save",
      people: {
        "person.alex": {
          sources: ["sensor.alex_phone_area", "sensor.alex_watch_area"],
          color: "#e8508a",
        },
        "person.sam": { sources: ["sensor.sam_phone_area"], color: "#2f9fd8" },
      },
      shown: "admins",
      look: "pin",
      expected_revision: 1,
    });
  });

  for (const theme of ["day", "neon"] as const) {
    test(`people in the ${theme} look`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openHarness(page, { live: true, people: true, theme });
      await expect(page.locator(".person-tag")).toHaveCount(2);
      await settle(page);
      expect(await canvasPng(page)).toMatchSnapshot(`people-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
