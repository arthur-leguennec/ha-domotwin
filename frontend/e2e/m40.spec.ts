import { expect, test, type Page } from "@playwright/test";

import { canvasPng, fromMenu, openHarness, settle, viewState } from "./fixtures";

/** Sets a weather entity's condition, as Home Assistant would. */
async function weather(page: Page, id: string, condition: string): Promise<void> {
  await page.evaluate(
    ({ id, condition }) => {
      (window as never as { __setState(id: string, state: string): void }).__setState(
        id,
        condition,
      );
    },
    { id, condition },
  );
}

/** Frames drawn over `ms`. */
async function framesOver(page: Page, ms: number): Promise<number> {
  const before = (await viewState(page)).frames;
  await page.waitForTimeout(ms);
  return (await viewState(page)).frames - before;
}

test.describe("the weather around the home (D-067)", () => {
  test("rain falls while it rains, then snow, and nothing on a fine day", async ({ page }) => {
    await openHarness(page, { weather: "sunny", north: 90 });
    await expect(page.getByTestId("summary")).toBeVisible();
    // A fine day: nothing falls, nothing more to draw.
    await expect
      .poll(async () => (await viewState(page)).weather)
      .toBe("weather.home sunny 5 225:90");
    expect((await viewState(page)).falling).toBe("none");
    await expect.poll(() => framesOver(page, 400)).toBe(0);
    const fine = await canvasPng(page);

    await weather(page, "weather.home", "rainy");
    await expect.poll(async () => (await viewState(page)).falling).toBe("rain");
    // It falls, drawn at the layers' slower pace rather than the display's.
    expect(await framesOver(page, 1500)).toBeGreaterThan(1);
    expect((await viewState(page)).frameInterval).toBeGreaterThan(30);
    expect((await canvasPng(page)).equals(fine)).toBe(false);

    await weather(page, "weather.home", "snowy");
    await expect.poll(async () => (await viewState(page)).falling).toBe("snow");
    await weather(page, "weather.home", "hail");
    await expect.poll(async () => (await viewState(page)).falling).toBe("hail");

    // Fog: nothing falls, the home is greyed in the distance, and nothing moves.
    await weather(page, "weather.home", "fog");
    await expect.poll(async () => (await viewState(page)).falling).toBe("none");
    await expect.poll(() => framesOver(page, 400)).toBe(0);
    await settle(page);
    expect((await canvasPng(page)).equals(fine)).toBe(false);

    // Back to a fine day: the same picture as before.
    await weather(page, "weather.home", "sunny");
    await expect.poll(() => framesOver(page, 400)).toBe(0);
    await settle(page);
    expect((await canvasPng(page)).equals(fine)).toBe(true);
  });

  test("an entity that says nothing, and the card's option, draw no weather", async ({ page }) => {
    await openHarness(page, { weather: "rainy" });
    await expect.poll(async () => (await viewState(page)).falling).toBe("rain");
    await weather(page, "weather.home", "unavailable");
    // The usual one says nothing now: the next that does is drawn.
    await expect
      .poll(async () => (await viewState(page)).weather)
      .toMatch(/^weather\.coast pouring /);
    await weather(page, "weather.coast", "unknown");
    await expect.poll(async () => (await viewState(page)).weather).toBe("clear");
    expect((await viewState(page)).falling).toBe("none");

    await openHarness(page, { weather: "rainy", weatherOption: false });
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect.poll(async () => (await viewState(page)).weather).toBe("clear");
    expect((await viewState(page)).falling).toBe("none");
  });

  test("the settings choose the entity, or none, shown as it is chosen", async ({ page }) => {
    await openHarness(page, { mode: "panel", weather: "sunny", lang: "fr" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect.poll(async () => (await viewState(page)).weather).toMatch(/^weather\.home sunny /);
    await fromMenu(page, "settings");
    const dialog = page.getByTestId("settings-dialog");
    await expect(
      dialog.getByRole("heading", { name: "La météo autour du logement" }),
    ).toBeVisible();
    const select = dialog.getByTestId("settings-weather");
    await expect(select.locator("option")).toHaveText([
      "Automatique (Forecast Home)",
      "Forecast Coast",
      "Forecast Home",
      "Aucune : pas de météo dessinée",
    ]);
    // Shown as it is chosen.
    await select.selectOption("weather.coast");
    await expect.poll(async () => (await viewState(page)).falling).toBe("rain");
    await select.selectOption("none");
    await expect.poll(async () => (await viewState(page)).weather).toBe("clear");
    // Cancelled: as it was.
    await dialog.getByRole("button", { name: "Annuler" }).click();
    await expect.poll(async () => (await viewState(page)).weather).toMatch(/^weather\.home sunny /);

    await fromMenu(page, "settings");
    await dialog.getByTestId("settings-weather").selectOption("weather.coast");
    await dialog.getByTestId("settings-save").click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as never as { __store: { settings: { weather?: string } } }).__store.settings
            .weather,
      ),
    ).toBe("weather.coast");
    await expect.poll(async () => (await viewState(page)).falling).toBe("rain");

    // Automatic again: the choice is left out.
    await fromMenu(page, "settings");
    await dialog.getByTestId("settings-weather").selectOption("");
    await dialog.getByTestId("settings-save").click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(
        () => "weather" in (window as never as { __store: { settings: object } }).__store.settings,
      ),
    ).toBe(false);
  });
});
