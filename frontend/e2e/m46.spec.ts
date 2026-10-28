import { expect, test, type Page } from "@playwright/test";

import { openHarness } from "./fixtures";

interface Call {
  type: string;
  domain?: string;
  service?: string;
  data?: Record<string, unknown>;
  target?: { entity_id?: string[] };
}

function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => (window as never as { __calls: Call[] }).__calls);
}

function kept(page: Page): Promise<{ id: string; name: string; steps: unknown[] }[]> {
  return page.evaluate(
    () => (window as never as { __choices: { shortcuts?: never[] } }).__choices.shortcuts ?? [],
  );
}

test.describe("shortcuts on the Home tab (D-084)", () => {
  test("suggests the first ones from the home, added and pressed in one go", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    const section = page.getByTestId("home-shortcuts");
    await expect(section).toBeVisible();
    // None yet: three suggestions from the home's devices.
    const suggested = section.locator("button[data-suggestion]");
    await expect(suggested).toHaveCount(3);
    await expect(suggested.first()).toContainText("All the lights off");
    await suggested.first().click();
    // Kept for the user, shown with what it acts on.
    await expect.poll(async () => (await kept(page)).length).toBe(1);
    const tile = section.locator("button[data-shortcut]");
    await expect(tile).toHaveCount(1);
    await expect(tile.getByTestId("shortcut-state")).toContainText(/on|All off/);
    await expect(suggested).toHaveCount(0);
    // A press: every lamp of the home off, in one call.
    await tile.click();
    await expect
      .poll(async () =>
        (await calls(page)).some(
          (c) =>
            c.domain === "light" &&
            c.service === "turn_off" &&
            (c.target?.entity_id?.length ?? 0) > 1,
        ),
      )
      .toBe(true);
  });

  test("adjusts a suggestion: a room, a question first, then changes and deletes it", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await page.getByTestId("shortcuts-add").click();
    const dialog = page.getByTestId("shortcut-dialog");
    await expect(dialog).toBeVisible();
    // Suggestions by what they are about, each with how many devices it acts on.
    await expect(dialog.locator("h3").first()).toHaveText("Lights");
    const lights = dialog.locator("li[data-suggestion='lights_off']");
    await expect(lights).toContainText("devices");
    await lights.getByRole("button", { name: "Adjust" }).click();
    // What it does and where first.
    const name = dialog.locator("input[data-field='name']");
    await expect(name).toHaveValue("All the lights off");
    await expect(name).toBeFocused();
    await name.fill("Living room off");
    const where = dialog.locator("select[data-field='where']");
    await where.selectOption({ label: "Living room" });
    await expect(dialog.getByTestId("step-now")).toContainText("Acts on");
    // More options: a question before it acts, what is left out.
    await dialog.getByTestId("shortcut-more-toggle").click();
    await expect(dialog.getByTestId("shortcut-more")).toBeVisible();
    await dialog.locator("input[data-field='confirm']").check();
    await dialog.getByTestId("shortcut-save").click();
    await expect(dialog).toBeHidden();
    const saved = (await kept(page))[0];
    expect(saved).toMatchObject({
      name: "Living room off",
      confirm: true,
      steps: [{ kind: "lights", do: "off", area: "living_room" }],
    });
    // Asked first; then only the living room's lamps.
    const tile = page.locator("button[data-shortcut]");
    await tile.click();
    await expect(page.locator(".asking")).toContainText("Living room off: go ahead?");
    const before = (await calls(page)).length;
    await page.getByTestId("shortcut-yes").click();
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(before);
    const call = (await calls(page)).at(-1);
    expect(call?.service).toBe("turn_off");
    // The living room's lamps, by their area or their device's.
    const living = await page.evaluate(() => {
      const hass = (
        window as never as {
          __hass: {
            entities: Record<string, { entity_id: string; area_id?: string; device_id?: string }>;
            devices: Record<string, { area_id?: string }>;
            states: Record<string, unknown>;
          };
        }
      ).__hass;
      return Object.values(hass.entities)
        .filter((e) => e.entity_id.startsWith("light.") && hass.states[e.entity_id])
        .filter(
          (e) =>
            (e.area_id ?? (e.device_id ? hass.devices[e.device_id]?.area_id : undefined)) ===
            "living_room",
        )
        .map((e) => e.entity_id)
        .sort();
    });
    expect([...(call?.target?.entity_id ?? [])].sort()).toEqual(living);
    // Changed: a press opens it; deleted.
    await page.getByTestId("shortcuts-change").click();
    await tile.click();
    await expect(dialog.locator("input[data-field='name']")).toHaveValue("Living room off");
    await dialog.getByTestId("shortcut-remove").click();
    await expect.poll(async () => (await kept(page)).length).toBe(0);
  });

  test("makes one of several steps, and one that shows a value", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await page.getByTestId("shortcuts-add").click();
    const dialog = page.getByTestId("shortcut-dialog");
    await dialog.getByTestId("shortcut-own").click();
    await dialog.locator("input[data-field='name']").fill("Movie");
    await dialog.locator("[data-step='0'] select[data-field='do']").selectOption("on");
    await dialog.locator("[data-step='0'] input[data-field='value']").fill("20");
    await dialog.getByTestId("shortcut-more-toggle").click();
    await dialog.getByTestId("step-add").click();
    await dialog.locator("[data-step='1'] select[data-field='kind']").selectOption("covers");
    await dialog.getByTestId("shortcut-save").click();
    await expect(dialog).toBeHidden();
    expect((await kept(page))[0]?.steps).toEqual([
      { kind: "lights", do: "on", value: 20 },
      { kind: "covers", do: "close" },
    ]);
    await page.locator("button[data-shortcut]").click();
    await expect
      .poll(async () => (await calls(page)).some((c) => c.service === "close_cover"))
      .toBe(true);
    expect((await calls(page)).find((c) => c.service === "turn_on")?.data).toEqual({
      brightness_pct: 20,
    });
    // A value: the entrance lock's battery.
    await page.getByTestId("shortcuts-add").click();
    await dialog.getByTestId("shortcut-own").click();
    await dialog.locator("input[data-field='name']").fill("Battery");
    await dialog.getByTestId("shortcut-more-toggle").click();
    await dialog.locator("select[data-field='shows']").selectOption("value");
    await dialog
      .locator("select[data-field='show']")
      .selectOption({ label: "Entrance door lock battery" });
    // Nothing to do, only to show.
    await dialog.getByTestId("step-remove").click();
    await expect(dialog.locator("fieldset.step")).toHaveCount(0);
    await dialog.getByTestId("shortcut-save").click();
    const battery = page.locator("button[data-shortcut]").nth(1);
    await expect(battery.getByTestId("shortcut-state")).toContainText("%");
  });

  test("says what it cannot do", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await page.locator("button[data-suggestion]").first().click();
    await page.evaluate(() => {
      (window as never as { __failServices: boolean }).__failServices = true;
    });
    await page.locator("button[data-shortcut]").click();
    await expect(page.getByTestId("shortcut-said")).toContainText("refused part of it");
  });

  test("shows none before the user's own are read, then theirs", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home", holdChoices: true });
    await expect(page.getByTestId("home-tab")).toBeVisible();
    // Not read yet: no suggestion to press, that would take the user's own away.
    await expect(page.getByTestId("home-shortcuts")).toHaveCount(0);
    await page.evaluate(() => {
      const choices = (window as never as { __choices: { shortcuts?: unknown[] } }).__choices;
      choices.shortcuts = [
        { id: "kept", name: "Lock up", icon: "lock", steps: [{ kind: "locks", do: "lock" }] },
      ];
      (window as never as { __releaseChoices: () => void }).__releaseChoices();
    });
    const tile = page.locator("button[data-shortcut]");
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText("Lock up");
    await expect(page.locator("button[data-suggestion]")).toHaveCount(0);
  });

  test("keeps another device's shortcuts: one change at a time", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await page.locator("button[data-suggestion]").first().click();
    await expect.poll(async () => (await kept(page)).length).toBe(1);
    // Meanwhile, a phone adds one.
    await page.evaluate(() => {
      const choices = (window as never as { __choices: { shortcuts: unknown[] } }).__choices;
      choices.shortcuts.push({
        id: "phone",
        name: "Lock up",
        icon: "lock",
        steps: [{ kind: "locks", do: "lock" }],
      });
    });
    // This screen, not knowing it, deletes its own: the phone's stays.
    await page.getByTestId("shortcuts-change").click();
    await page.locator("button[data-shortcut]").first().click();
    await page.getByTestId("shortcut-dialog").getByTestId("shortcut-remove").click();
    await expect.poll(async () => (await kept(page)).map((s) => s.id)).toEqual(["phone"]);
    await expect(page.locator("button[data-shortcut]")).toContainText("Lock up");
  });

  test("says a change was not kept, and shows what is", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await page.evaluate(() => {
      (window as never as { __failShortcuts: boolean }).__failShortcuts = true;
    });
    await page.locator("button[data-suggestion]").first().click();
    await expect(page.getByText("you have 24 shortcuts already")).toBeVisible();
    // Read again: none was kept, the suggestions are back.
    await expect(page.locator("button[data-shortcut]")).toHaveCount(0);
    await expect(page.locator("button[data-suggestion]")).toHaveCount(3);
  });

  test("brings a number into its range", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home" });
    await page.getByTestId("shortcuts-add").click();
    const dialog = page.getByTestId("shortcut-dialog");
    await dialog.getByTestId("shortcut-own").click();
    await dialog.locator("input[data-field='name']").fill("Half open");
    await dialog.locator("[data-step='0'] select[data-field='kind']").selectOption("covers");
    await dialog.locator("[data-step='0'] select[data-field='do']").selectOption("position");
    const value = dialog.locator("[data-step='0'] input[data-field='value']");
    await expect(value).toHaveValue("50");
    await value.fill("150");
    await value.press("Tab");
    await expect(value).toHaveValue("100");
    // Cleared, a position keeps its number.
    await value.fill("");
    await value.press("Tab");
    await expect(value).toHaveValue("100");
    // A temperature typed key by key, its decimal point kept.
    await dialog.getByTestId("shortcut-more-toggle").click();
    await dialog.getByTestId("step-add").click();
    await dialog.locator("[data-step='1'] select[data-field='kind']").selectOption("climate");
    await dialog.locator("[data-step='1'] select[data-field='do']").selectOption("temperature");
    const heat = dialog.locator("[data-step='1'] input[data-field='value']");
    await heat.fill("");
    await heat.pressSequentially("20.5");
    await heat.press("Tab");
    await expect(heat).toHaveValue("20.5");
    await dialog.getByTestId("shortcut-save").click();
    await expect(dialog).toBeHidden();
    expect((await kept(page))[0]?.steps).toEqual([
      { kind: "covers", do: "position", value: 100 },
      { kind: "climate", do: "temperature", value: 20.5 },
    ]);
  });

  test("is the first thing on a phone, the 3D a tab away", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHarness(page, { mode: "panel", live: true, start: "none" });
    await expect(page.getByTestId("tab-home")).toHaveAttribute("aria-current", "page");
    const section = page.getByTestId("home-shortcuts");
    await expect(section).toBeInViewport();
    await expect(page.getByTestId("tab-3d")).toBeVisible();
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, start: "home", lang: "fr" });
    await expect(page.locator("#shortcuts-title")).toHaveText("Commandes");
    await expect(page.locator("button[data-suggestion]").first()).toContainText(
      "Éteindre toutes les lumières",
    );
  });
});
