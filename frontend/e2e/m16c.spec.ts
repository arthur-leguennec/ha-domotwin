import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, viewState } from "./fixtures";

/** What was asked of the visitor's own (mocked) Home Assistant. */
function realCalls(page: Page): Promise<{ type: string }[]> {
  return page.evaluate(() => (window as never as { __calls: { type: string }[] }).__calls);
}

/** The name of the plan the view shows. */
async function shown(page: Page): Promise<string | undefined> {
  return (await viewState(page)).summary?.name;
}

test.describe("the demo house (D-050)", () => {
  test("offered when there is no plan: it lives its day, and nothing reaches the home", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true });
    const before = (await realCalls(page)).length;
    await page.getByTestId("demo-try").click();
    const bar = page.getByTestId("demo-bar");
    await expect(bar).toContainText("Nothing here touches your home.");
    await expect.poll(() => shown(page)).toBe("Demo house");
    // Its robot vacuum leaves the dock at nine, while the house is quiet.
    await expect
      .poll(async () => (await viewState(page)).robots, { timeout: 15_000 })
      .toContain("cleaning");
    // Midday: the sun on the panels, the battery charging, shown with the power layer.
    // Held, the time stays where it is sent.
    await page.getByTestId("demo-play").click();
    await expect(page.getByTestId("demo-play")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("demo-noon").click();
    await expect(page.getByTestId("demo-time")).toHaveText("12:50");
    // The power layer, from the Energy tab (D-049).
    await page.getByTestId("tab-energy").click();
    await expect(page.getByTestId("energy")).toHaveAttribute("aria-label", /the sun gives/);
    await page.getByTestId("tab-3d").click();
    // The evening: the lamps of the evening scene on.
    await page.getByTestId("demo-evening").click();
    await expect(page.getByTestId("demo-time")).toHaveText("19:40");
    // What the visitor does stays in the demo: its lamp, not the home's.
    const lamp = await page.evaluate(async () => {
      const view = (
        window as never as {
          __view: () => {
            hass: {
              states: Record<string, { state: string } | undefined>;
              callService(d: string, s: string, data: object, target: object): Promise<unknown>;
            };
          };
        }
      ).__view();
      await view.hass.callService("light", "turn_on", {}, { entity_id: "light.office_ceiling" });
      const home = (window as never as { __hass: { states: Record<string, unknown> } }).__hass;
      return {
        demo: view.hass.states["light.office_ceiling"]?.state,
        home: home.states["light.office_ceiling"] === undefined,
      };
    });
    expect(lamp).toEqual({ demo: "on", home: true });
    // Back to the home, as it was, links being made in the demo dropped: nothing was saved
    // there, no service called.
    await page.getByTestId("link-mode").click();
    await expect(page.getByTestId("link-mode")).toHaveAttribute("aria-label", "Done linking");
    await page.getByTestId("demo-leave").click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("demo-try")).toBeVisible();
    const calls = (await realCalls(page)).slice(before);
    expect(
      calls.filter(
        (c) => c.type === "call_service" || /\/(save|add|cancel|done|hide|remove)$/.test(c.type),
      ),
    ).toEqual([]);
  });

  test("from the menu of a home with its plan, in its language, and back to it", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", lang: "fr" });
    await expect.poll(() => shown(page)).toBe("Demo apartment");
    await fromMenu(page, "demo-menu");
    await expect.poll(() => shown(page)).toBe("Maison de démo");
    await expect(page.getByTestId("demo-bar")).toContainText("Rien ici ne touche votre maison.");
    // Its upper floor too.
    await page.getByTestId("storeys").locator('[data-storey="upper"]').click();
    await expect.poll(() => shown(page)).toBe("Maison de démo, étage");
    await fromMenu(page, "demo-leave-menu");
    await expect.poll(() => shown(page)).toBe("Demo apartment");
  });

  test("a card shows it when set to, without the way out", async ({ page }) => {
    await openHarness(page, { demo: true });
    await expect(page.getByTestId("demo-bar")).toBeVisible();
    await expect(page.getByTestId("demo-leave")).toHaveCount(0);
    await expect.poll(() => shown(page)).toBe("Demo house");
  });
});
