import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** Changes an entity as a device would. */
async function setState(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ([entity, state]) => {
      (window as never as { __setState: (id: string, state: string) => void }).__setState(
        entity as string,
        state as string,
      );
    },
    [id, value],
  );
}

/** The wall screens as the mocked integration keeps them. */
function screens(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    (window as never as { __screens: () => Record<string, unknown> }).__screens(),
  );
}

test.describe("the wall screen (D-076)", () => {
  test("an administrator sets a screen, and a device becomes it", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      wall: true,
      start: "home",
    });
    await page.getByTestId("choices-open").click();
    const choices = page.locator("domotwin-choices");
    await expect(choices.getByTestId("choices-screen")).toHaveValue("");
    await choices.getByRole("button", { name: "Cancel" }).click();
    await expect(choices).toHaveCount(0);
    await fromMenu(page, "screens-menu");
    const dialog = page.getByTestId("screens-dialog");
    await expect(dialog).toBeVisible();
    // The hall's, as kept; a screen keeps its name.
    await expect(dialog.locator('[data-screen="hall"]')).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByTestId("screens-shown")).toHaveText("hall");
    await expect(dialog.getByTestId("screens-name")).toHaveCount(0);
    await expect(dialog.getByTestId("screens-after")).toHaveValue("1");
    await expect(dialog.getByTestId("screens-photos")).toHaveText("From holidays");
    // A new screen for the kitchen.
    await dialog.getByTestId("screens-add").click();
    await dialog.getByTestId("screens-name").fill("kitchen");
    await dialog.getByTestId("screens-start").selectOption("rooms");
    await dialog.getByTestId("screens-after").selectOption("2");
    await dialog.locator('[data-wake="binary_sensor.hall_motion"]').check();
    await dialog.getByTestId("screens-photos-pick").click();
    const browse = dialog.getByTestId("screens-browse");
    await expect(browse.getByTestId("screens-browse-use")).toBeDisabled();
    await browse.locator('[data-folder="My media"]').click();
    await browse.locator('[data-folder="recipes"]').click();
    await expect(browse).toContainText("No photo here.");
    await expect(browse.getByTestId("screens-browse-use")).toBeDisabled();
    await browse.getByTestId("screens-browse-up").click();
    await browse.locator('[data-folder="holidays"]').click();
    await expect(browse).toContainText("3 photos here");
    await browse.getByTestId("screens-browse-use").click();
    await expect(dialog.getByTestId("screens-photos")).toHaveText("From holidays");
    await dialog.getByTestId("screens-every").selectOption("20");
    await dialog.getByTestId("screens-weather").uncheck();
    await dialog.getByTestId("screens-save").click();
    await expect(dialog.getByTestId("screens-status")).toHaveText("kitchen is saved.");
    expect((await screens(page)).kitchen).toEqual({
      start: "rooms",
      saver: {
        after: 2,
        wake: ["binary_sensor.hall_motion"],
        weather: false,
        photos: "media-source://media_source/local/holidays",
        every: 20,
        dim: true,
      },
    });
    // A name taken is refused before it is sent.
    await dialog.getByTestId("screens-add").click();
    await dialog.getByTestId("screens-name").fill("HALL");
    await dialog.getByTestId("screens-save").click();
    await expect(dialog.getByRole("alert")).toHaveText("Another screen has this name.");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);

    // This device becomes the kitchen's screen.
    await page.getByTestId("choices-open").click();
    await choices.getByTestId("choices-screen").selectOption("kitchen");
    await choices.getByRole("button", { name: "Save" }).click();
    await expect(choices).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("domotwin-screen"))).toBe("kitchen");
  });

  test("the screen saver comes when nobody is there and goes when someone is", async ({ page }) => {
    await page.clock.install();
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      wall: true,
      deviceScreen: "hall",
      weather: "sunny",
      safety: true,
      // The device's own tab: the screen's is taken over it.
      start: "3d",
    });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await page.getByTestId("tab-rooms").click();
    const saver = page.getByTestId("saver");
    await page.clock.fastForward("00:50");
    await expect(saver).toHaveCount(0);
    await page.clock.fastForward("00:20");
    await expect(saver).toBeVisible();
    await expect(saver.getByTestId("saver-time")).toHaveText(/^\d{1,2}:\d{2}( [AP]M)?$/);
    await expect(saver.getByTestId("saver-weather")).toContainText("Sunny");
    await expect(saver.getByTestId("saver-photo")).toHaveAttribute("src", /^data:image\/svg/);
    // Back on its tab underneath, for whoever comes next.
    await expect(page.getByTestId("tab-home")).toHaveAttribute("aria-current", "page");

    // Someone moves before it: woken; and while they are there, it stays away.
    await setState(page, "binary_sensor.hall_motion", "on");
    await expect(saver).toHaveCount(0);
    await page.clock.fastForward("02:00");
    await expect(saver).toHaveCount(0);
    await setState(page, "binary_sensor.hall_motion", "off");
    await page.clock.fastForward("01:10");
    await expect(saver).toBeVisible();
    // A tap wakes it, and does nothing else.
    await saver.click();
    await expect(saver).toHaveCount(0);
    await expect(page.getByTestId("tab-home")).toHaveAttribute("aria-current", "page");
    // A key too.
    await page.clock.fastForward("01:10");
    await expect(saver).toBeVisible();
    await page.keyboard.press("Space");
    await expect(saver).toHaveCount(0);
    // A doorbell rings: the screen wakes under it.
    await page.clock.fastForward("01:10");
    await expect(saver).toBeVisible();
    await page.evaluate(() => {
      (window as never as { __ring: () => void }).__ring();
    });
    await expect(page.getByTestId("doorbell")).toBeVisible();
    await expect(saver).toHaveCount(0);
  });

  test("domotwin.show naming this screen wakes it; another screen's does not", async ({ page }) => {
    await page.clock.install();
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      wall: true,
      deviceScreen: "Hall",
    });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await page.clock.fastForward("01:10");
    const saver = page.getByTestId("saver");
    await expect(saver).toBeVisible();
    const show = (request: Record<string, string>): Promise<void> =>
      page.evaluate((r) => {
        (window as never as { __show: (r: unknown) => void }).__show(r);
      }, request);
    await show({ room: "kitchen", screen: "kitchen_wall" });
    await page.clock.fastForward("00:05");
    await expect(saver).toBeVisible();
    await show({ room: "kitchen", screen: "HALL" });
    await expect(saver).toHaveCount(0);
    await expect(page.getByTestId("tab-3d")).toHaveAttribute("aria-current", "page");
  });

  test("without a plan, an administrator reaches the wall screens from the Home tab", async ({
    page,
  }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      wall: true,
      plan: "none",
      start: "home",
    });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await page.getByTestId("screens-open").click();
    await expect(page.getByTestId("screens-dialog").locator('[data-screen="hall"]')).toBeVisible();
  });

  test("at night, the clock alone, dimmed; in French", async ({ page }) => {
    await page.clock.install();
    await openHarness(page, {
      mode: "panel",
      live: true,
      cards: true,
      wall: true,
      deviceScreen: "hall",
      weather: "clear-night",
      sun: { elevation: -12, rising: false },
      lang: "fr",
    });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    await page.clock.fastForward("01:10");
    const saver = page.getByTestId("saver");
    await expect(saver).toBeVisible();
    await expect(saver).toHaveAttribute("aria-label", /Économiseur d’écran/);
    await expect(saver).toHaveClass(/night/);
    await expect(saver.getByTestId("saver-photo")).toHaveCount(0);
    await expect(saver.getByTestId("saver-time")).toBeVisible();
  });
});
