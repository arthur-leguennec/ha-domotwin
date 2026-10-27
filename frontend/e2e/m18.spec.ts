import { expect, test, type Page } from "@playwright/test";

import { elementPoint, fromMenu, openHarness, settle, viewState } from "./fixtures";

/** Sends the demo house to `minute` of its day, as its bar's moments do. */
async function jump(page: Page, minute: number): Promise<void> {
  await page.evaluate((minute) => {
    const find = (root: Document | ShadowRoot): Element | undefined => {
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.tagName.toLowerCase() === "domotwin-demo-bar") return element;
        const inner = element.shadowRoot ? find(element.shadowRoot) : undefined;
        if (inner) return inner;
      }
      return undefined;
    };
    const bar = find(document) as unknown as { home: { jump(minute: number): void } };
    bar.home.jump(minute);
  }, minute);
}

/** Where the demo house's robot mower is, and the lawn it mows. */
async function mower(page: Page): Promise<{ at: [number, number]; cleaning: string | null }> {
  const found = (await viewState(page)).stats?.robots.find((r) => r.id === "mower-dock");
  if (!found) throw new Error("no robot mower");
  return found;
}

test.describe("the garden (D-077)", () => {
  test("the demo house's robot mower mows the back lawn; a lawn is said just mown", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", plan: "none", live: true });
    await page.getByTestId("demo-try").click();
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
    // Out on the back lawn late in the morning, never in the house.
    await jump(page, 11 * 60);
    await expect
      .poll(async () => (await viewState(page)).robots, { timeout: 15_000 })
      .toContain('{"id":"mower-dock","state":"mowing"}');
    await expect
      .poll(async () => (await mower(page)).cleaning, { timeout: 15_000 })
      .toBe("back-garden");
    for (let k = 0; k < 4; k += 1) {
      await page.waitForTimeout(500);
      expect((await mower(page)).at[1]).toBeLessThan(-25);
    }
    // The front lawn: mown three days ago, said just mown by anyone.
    const view = page.locator("domotwin-view");
    const front = view.getByTestId("room-list").locator('[data-room="front-garden"]');
    await front.focus();
    await page.keyboard.press("Enter");
    const lawn = view.getByTestId("room").getByTestId("room-lawn");
    await expect(lawn).toContainText("mown 3 days ago");
    await view.getByTestId("room").getByTestId("lawn-mowed").click();
    await expect(lawn).toContainText("Grass about 4 cm, mown now.");
  });

  test("a room drawn as a place outside, with its ground and its railing", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("plan-mode").click();
    const bar = page.locator("domotwin-plan-bar");
    await expect.poll(async () => (await viewState(page)).stats?.planView).toBe(true);
    await settle(page);
    const sofa = await elementPoint(page, "sofa");
    await page.mouse.click(sofa.x, sofa.y);
    await expect(bar.getByTestId("plan-name")).toHaveValue("Living room");
    // Indoors: no railing, the floors of a room.
    await expect(bar.getByTestId("plan-railing")).toHaveCount(0);
    await expect(bar.getByTestId("plan-floor").locator("option")).toHaveCount(6);
    // Outside: on a lawn, the grounds of a garden offered, a railing if it is a balcony.
    await bar.getByTestId("plan-outside").check();
    await expect(bar.getByTestId("plan-floor")).toHaveValue("lawn");
    await expect(bar.getByTestId("plan-floor").locator("option")).toHaveText([
      "Lawn",
      "Decking",
      "Paving",
      "Gravel",
      "Soil",
    ]);
    await bar.getByTestId("plan-floor").selectOption("decking");
    await bar.getByTestId("plan-railing").check();
    await expect.poll(async () => (await viewState(page)).planEdit?.dirty).toBe(true);
    await expect(bar.getByTestId("plan-floor")).toHaveValue("decking");
    await expect(bar.getByTestId("plan-railing")).toBeChecked();
  });

  test("the roofs' shape, slope and colour, chosen in the settings", async ({ page }) => {
    await openHarness(page, { mode: "panel", storeys: 2 });
    await page.getByTestId("storeys").locator('[data-storey="all"]').click();
    await expect.poll(async () => (await viewState(page)).stats?.roofs).toBeGreaterThan(0);
    await fromMenu(page, "settings");
    const dialog = page.getByTestId("settings-dialog");
    // Shown as it is chosen: a hip roof.
    await dialog.getByTestId("settings-roof-shape").selectOption("hip");
    await expect.poll(async () => (await viewState(page)).stats?.roofShape).toBe("hip");
    // A flat roof has no slope to choose.
    await dialog.getByTestId("settings-roof-shape").selectOption("flat");
    await expect(dialog.getByTestId("settings-roof-pitch")).toHaveCount(0);
    await dialog.getByTestId("settings-roof-shape").selectOption("hip");
    await dialog.getByTestId("settings-roof-pitch").fill("45");
    await dialog.getByTestId("settings-save").click();
    await expect(page.getByTestId("toast")).toContainText("Settings saved.");
    const stored = await page.evaluate(
      () =>
        (window as never as { __store: { settings: { roof?: unknown } } }).__store.settings.roof,
    );
    expect(stored).toEqual({ shape: "hip", pitch: 45 });
  });
});
