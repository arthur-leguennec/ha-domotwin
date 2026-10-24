import { expect, test, type Page } from "@playwright/test";

import { elementPoint, openHarness, settle, viewState } from "./fixtures";

interface StoredStorey {
  id: string;
  name: string;
  elevation: number;
  plan: {
    name?: string;
    rooms?: { id: string }[];
    partitions?: { id: string }[];
    doors?: { id: string }[];
    windows?: { id: string }[];
    items?: { id: string; room?: string }[];
  };
}

/** The storeys the mocked integration holds. */
function storeys(page: Page): Promise<StoredStorey[]> {
  return page.evaluate(() =>
    structuredClone((window as never as { __store: { storeys: StoredStorey[] } }).__store.storeys),
  );
}

/** Every element id of the home: none is on two storeys. */
function expectIdsOfTheirOwn(home: StoredStorey[]): void {
  const ids = home.flatMap(({ plan }) =>
    [plan.rooms, plan.partitions, plan.doors, plan.windows, plan.items].flatMap((list) =>
      (list ?? []).map((element) => element.id),
    ),
  );
  expect(new Set(ids).size).toBe(ids.length);
}

const IFC_FIXTURES = "../crates/domotwin-ifc/tests/fixtures";

/** The switcher's storey buttons, not the one showing every storey. */
const LEVELS = 'button:not([data-storey="all"])';

test.describe("storeys", () => {
  test("the switcher shows each storey, the highest on top, and stairs lead up and down", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", storeys: 2 });
    const summary = page.getByTestId("summary");
    await expect(summary).toContainText("Demo apartment");
    const switcher = page.getByTestId("storeys");
    // One button per storey, after the one showing every storey (D-028).
    await expect(switcher.locator(LEVELS)).toHaveText(["1", "0"]);
    await expect(switcher.locator('[data-storey="storey-1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await switcher.locator('[data-storey="storey-2"]').click();
    await expect(summary).toContainText("upper floor");
    await expect(summary).toContainText("5 rooms");
    await expect(switcher.locator('[data-storey="storey-2"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Only that storey's plan is drawn.
    await expect.poll(async () => (await viewState(page)).summary?.name).toContain("upper floor");
    // A tap on the stairs of the top storey goes down.
    await settle(page);
    const stairs = await elementPoint(page, "up-stairs");
    await page.mouse.click(stairs.x, stairs.y);
    await expect(summary).not.toContainText("upper floor");
    await expect(switcher.locator('[data-storey="storey-1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("an alert on another storey shows, marks its storey, and a tap goes there", async ({
    page,
  }) => {
    await openHarness(page, { storeys: 2, live: true });
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo apartment");
    await page.evaluate(() => {
      (window as never as { __setState: (id: string, state: string) => void }).__setState(
        "binary_sensor.office_smoke",
        "on",
      );
    });
    const banner = page.getByTestId("alerts");
    await expect(banner).toContainText("Smoke in Office (Floor 1)");
    expect((await viewState(page)).alerts).toEqual(["storey-2:up-office"]);
    const upstairs = page.getByTestId("storeys").locator('[data-storey="storey-2"]');
    await expect(upstairs).toHaveClass(/alert danger/);
    await expect(upstairs).toHaveAttribute("aria-label", "Floor 1, alert");
    // The tap shows the floor above and frames the office.
    await banner.locator('button[data-storey="storey-2"]').click();
    await expect.poll(async () => (await viewState(page)).summary?.name).toContain("upper floor");
    await expect(page.getByTestId("room-chip")).toContainText("Office");
    await expect(banner).toContainText("Smoke in Office");
    await expect(banner).not.toContainText("Floor 1");
    expect((await viewState(page)).alerts).toEqual(["up-office"]);
  });

  test("a card shows the storey of its options; one storey alone has no switcher", async ({
    page,
  }) => {
    await openHarness(page, { storeys: 2, storey: "storey-2" });
    await expect.poll(async () => (await viewState(page)).summary?.name).toContain("upper floor");
    await expect(page.getByTestId("storeys").locator('[data-storey="storey-2"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The option changed in the visual editor: the card follows it, whatever the switcher chose.
    const setStorey = (storey?: string): Promise<void> =>
      page.evaluate((storey) => {
        const card = (window as never as { __element: { setConfig(config: unknown): void } })
          .__element;
        card.setConfig({ type: "custom:domotwin-card", storey });
      }, storey);
    await setStorey("storey-1");
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo apartment");
    await page.getByTestId("storeys").locator('[data-storey="storey-2"]').click();
    await expect.poll(async () => (await viewState(page)).summary?.name).toContain("upper floor");
    await setStorey(undefined);
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo apartment");
    await openHarness(page, { storey: "storey-9" });
    // A storey since removed: the ground floor, without a switcher.
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo apartment");
    await expect(page.getByTestId("storeys")).toHaveCount(0);
  });

  test("storeys are renamed, raised and removed", async ({ page }) => {
    await openHarness(page, { mode: "panel", storeys: 2, lang: "fr" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("storeys-manage").click();
    const dialog = page.getByTestId("storeys-dialog");
    const upper = dialog.locator('[data-storey="storey-2"]');
    await expect(upper.getByTestId("storey-name")).toHaveAttribute("placeholder", "Étage 1");
    await expect(upper.getByTestId("storey-elevation")).toHaveValue("2.8");
    await upper.getByTestId("storey-name").fill("Combles");
    await upper.getByTestId("storey-name").press("Enter");
    await expect.poll(async () => (await storeys(page))[1]?.name).toBe("Combles");
    // A height not understood is marked and not sent; a decimal comma is read.
    await upper.getByTestId("storey-elevation").fill("haut");
    await upper.getByTestId("storey-elevation").press("Enter");
    await expect(upper.getByTestId("storey-elevation")).toHaveAttribute("aria-invalid", "true");
    await upper.getByTestId("storey-elevation").fill("3,1");
    await upper.getByTestId("storey-elevation").press("Enter");
    await expect.poll(async () => (await storeys(page))[1]?.elevation).toBe(310);
    await expect(upper.getByTestId("storey-elevation")).not.toHaveAttribute("aria-invalid");
    // The switcher names the storey as renamed.
    await expect(page.getByTestId("storeys").locator('[data-storey="storey-2"]')).toHaveAttribute(
      "title",
      "Combles",
    );
    // Removing asks first.
    await upper.getByTestId("storey-remove-ask").click();
    await expect(page.getByTestId("storey-remove")).toContainText("Combles");
    await page.getByTestId("storey-remove-confirm").click();
    await expect(page.getByTestId("toast")).toContainText("Combles");
    expect((await storeys(page)).map((storey) => storey.id)).toEqual(["storey-1"]);
    // The last storey cannot be removed; the switcher is gone.
    await expect(dialog.getByTestId("storey-remove-ask")).toBeDisabled();
    await expect(page.getByTestId("storeys")).toHaveCount(0);
  });

  test("a new storey is drawn above the others", async ({ page }) => {
    await openHarness(page, { mode: "panel", storeys: 2 });
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.getByTestId("storeys-manage").click();
    await page.getByTestId("storey-draw").click();
    // A new plan with one room, to save as a new storey.
    const bar = page.locator("domotwin-plan-bar");
    await expect(bar.getByTestId("plan-tool-room")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("plan-save")).toBeEnabled();
    await page.getByTestId("plan-save").click();
    await expect(page.getByTestId("toast")).toContainText("Plan saved.");
    const home = await storeys(page);
    expect(home).toHaveLength(3);
    const added = home[2];
    expect(added?.elevation).toBe(560);
    expect(added?.plan.rooms).toHaveLength(1);
    expectIdsOfTheirOwn(home);
    // The panel shows the new storey.
    await expect(page.getByTestId("storeys").locator(LEVELS)).toHaveCount(3);
    await expect(
      page.getByTestId("storeys").locator(`[data-storey="${added?.id ?? ""}"]`),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("summary")).toContainText("1 room");
  });

  test("a plan file is imported as a new storey, its ids made its own", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    // One storey: the switcher is not there, the storeys dialog is.
    await expect(page.getByTestId("storeys")).toHaveCount(0);
    await page.getByTestId("storeys-manage").click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("storey-import").click();
    // The same apartment again: every id is taken by the storey below.
    await (await chooser).setFiles("../examples/demo-apartment.domotwin.json");
    await expect(page.getByTestId("toast")).toContainText("Plan imported: Demo apartment.");
    const home = await storeys(page);
    expect(home).toHaveLength(2);
    expect(home[1]?.elevation).toBe(280);
    expectIdsOfTheirOwn(home);
    const renamed = home[1]?.plan;
    expect(renamed?.rooms?.some((element) => element.id === "living-2")).toBe(true);
    // A piece in the living room still is.
    expect(renamed?.items?.find((element) => element.id === "sofa-2")?.room).toBe("living-2");
    await expect(page.getByTestId("storeys").locator(LEVELS)).toHaveCount(2);
    // Importing again from the toolbar replaces the storey shown, not another.
    const again = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).first().click();
    await (await again).setFiles("../examples/demo-upper-floor.domotwin.json");
    await expect(page.getByTestId("summary")).toContainText("upper floor");
    const after = await storeys(page);
    expect(after).toHaveLength(2);
    expect(after[1]?.plan.name).toBe("Demo apartment, upper floor");
    expect(after[0]?.plan.name).toBe("Demo apartment");
  });

  test("every storey of an IFC file is imported at once", async ({ page }) => {
    await openHarness(page, { mode: "panel", storeys: 2 });
    await expect(page.getByTestId("summary")).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).first().click();
    await (await chooser).setFiles(`${IFC_FIXTURES}/house-ifc2x3.ifc`);
    await expect(page.getByTestId("ifc-storeys")).toBeVisible();
    await page.getByTestId("ifc-all").click();
    await expect(page.getByTestId("toast")).toContainText("storeys imported");
    const home = await storeys(page);
    // The file's storeys replace the home's.
    // The file's storeys replace the home's; their ids are taken again in order, so that a card
    // showing the floor above still does.
    expect(home.map((storey) => [storey.id, storey.name, storey.elevation])).toEqual([
      ["storey-1", "Rez-de-chaussée", 0],
      ["storey-2", "Étage", 280],
    ]);
    expect(home[1]?.plan.name).toContain("Étage");
    expectIdsOfTheirOwn(home);
    // The ground floor is shown.
    await expect(page.getByTestId("storeys").locator(LEVELS)).toHaveCount(2);
    await expect(page.getByTestId("summary")).toContainText("Rez-de-chaussée");
  });
});
