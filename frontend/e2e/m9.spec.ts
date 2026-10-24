import { expect, test, type Page } from "@playwright/test";

import { elementPoint, entityState, openHarness, settle, viewState } from "./fixtures";

/** The figures of the scene shown. */
async function stats(page: Page): Promise<{ storeys: number; spread: boolean; roof: boolean }> {
  return (await viewState(page)).stats as unknown as {
    storeys: number;
    spread: boolean;
    roof: boolean;
  };
}

test.describe("every storey at once", () => {
  test("a card shows every storey, spread apart under its roof; a storey's label shows it alone", async ({
    page,
  }) => {
    await openHarness(page, { storeys: 2, storey: "all", live: true });
    await expect.poll(async () => (await stats(page)).storeys).toBe(2);
    expect(await stats(page)).toMatchObject({ spread: true, roof: true });
    const view = page.locator("domotwin-view");
    // Each storey's label, with its rooms and the lights on.
    const labels = view.getByTestId("storey-labels").locator(".storey-label");
    await expect(labels).toHaveCount(2);
    await expect(labels.and(page.locator('[data-storey="storey-2"]'))).toContainText("Floor 1");
    await expect(labels.and(page.locator('[data-storey="storey-2"]'))).toContainText("1 light on");
    await expect(labels.and(page.locator('[data-storey="storey-1"]'))).toContainText("5 rooms");
    // A picture of each storey, the highest on top.
    const pictures = view.getByTestId("storey-pictures").locator(".picture");
    await expect(pictures).toHaveCount(2);
    await expect(pictures.first()).toHaveAttribute("data-storey", "storey-2");
    expect(await pictures.first().locator("img").getAttribute("src")).toMatch(/^data:image\/png/);
    // The switcher says so; the rooms' names give way to the storeys' labels.
    await expect(view.locator('.storey[data-storey="all"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(view.getByTestId("room-names")).toHaveCount(0);
    // A tap on a label shows that storey alone.
    await labels.and(page.locator('[data-storey="storey-1"]')).click();
    await expect.poll(async () => (await stats(page)).storeys).toBe(1);
    await expect(view.locator('.storey[data-storey="storey-1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(view.getByTestId("storey-labels")).toHaveCount(0);
  });

  test("the storeys stack and spread, the roof comes and goes, and a lamp upstairs is tapped", async ({
    page,
  }) => {
    await openHarness(page, { storeys: 2, live: true });
    const view = page.locator("domotwin-view");
    await expect(view.getByTestId("spread")).toHaveCount(0);
    await view.locator('.storey[data-storey="all"]').click();
    await expect.poll(async () => (await stats(page)).storeys).toBe(2);
    const spread = view.getByTestId("spread");
    await expect(spread).toHaveAttribute("aria-pressed", "true");
    await spread.click();
    await expect.poll(async () => (await stats(page)).spread).toBe(false);
    await expect(spread).toHaveAttribute("aria-pressed", "false");
    await view.getByTestId("roof").click();
    await expect.poll(async () => (await stats(page)).roof).toBe(false);
    await spread.click();
    await expect.poll(async () => (await stats(page)).spread).toBe(true);
    // The upper floor's lamp, live like any other.
    await settle(page);
    expect(await entityState(page, "light.office_lamp")).toBe("on");
    const lamp = await elementPoint(page, "up-lamp");
    await page.mouse.click(lamp.x, lamp.y);
    await expect.poll(() => entityState(page, "light.office_lamp")).toBe("off");
    // On the 2D plan the storeys lie side by side, each label over its storey; spreading and the
    // roof are for 3D.
    await view.getByTestId("toggle-plan").click();
    await settle(page);
    const labels = view.locator(".storey-label.top");
    await expect(labels).toHaveCount(2);
    await expect(spread).toHaveCount(0);
    const ground = await labels.and(page.locator('[data-storey="storey-1"]')).boundingBox();
    const upper = await labels.and(page.locator('[data-storey="storey-2"]')).boundingBox();
    // Across the view (the ground floor on the left), or down it (the highest on top).
    expect(ground && upper && (ground.x < upper.x || ground.y > upper.y)).toBe(true);
    expect((await stats(page)).roof).toBe(false);
  });

  test("the panel shows every storey; edit mode works on a storey alone, then comes back", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", storeys: 2 });
    await expect(page.getByTestId("summary")).toBeVisible();
    const view = page.locator("domotwin-view");
    await view.locator('.storey[data-storey="all"]').click();
    await expect.poll(async () => (await stats(page)).storeys).toBe(2);
    await page.getByTestId("edit-mode").click();
    await expect(page.getByTestId("edit-status")).toBeVisible();
    await expect.poll(async () => (await stats(page)).storeys).toBe(1);
    // Nothing changed: leaving asks nothing.
    await page.getByTestId("edit-cancel").click();
    await expect.poll(async () => (await stats(page)).storeys).toBe(2);
  });
});
