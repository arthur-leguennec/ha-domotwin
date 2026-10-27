import { expect, test } from "@playwright/test";

import { openHarness, pointOn, settle, stage } from "./fixtures";

const xy = (point: { x: number; y: number }): [number, number] => [point.x, point.y];

test.describe("into Home Assistant's Overview (D-061)", () => {
  test("a room tapped in 3D opens its area's page in the Overview, and back", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "3d",
      route: true,
      overview: true,
    });
    await expect(page).toHaveURL(/\/domotwin\/3d(\?|$)/);
    await settle(page);
    await page.mouse.click(...xy(await pointOn(page, "bedroom")));
    await expect(page).toHaveURL(/\/home\/areas-bedroom(\?|$)/);
    await page.goBack();
    await expect(page).toHaveURL(/\/domotwin\/3d(\?|$)/);
    await expect(stage(page)).toBeVisible();
  });

  test("before the Overview, the room's page in Rooms, as before", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "3d",
      route: true,
    });
    await settle(page);
    await page.mouse.click(...xy(await pointOn(page, "bedroom")));
    await expect(page).toHaveURL(/\/domotwin\/rooms\/bedroom(\?|$)/);
  });

  test("a layer asked for in the address is shown, then left out of it", async ({ page }) => {
    await openHarness(page, {
      mode: "panel",
      live: true,
      start: "none",
      userStart: "3d",
      route: true,
      path: "/3d",
      layer: "upkeep",
    });
    await expect(page.getByTestId("layers")).toHaveClass(/on/);
    expect(new URL(page.url()).searchParams.has("layer")).toBe(false);
  });

  test("the summaries say what DomoTwin knows, and open the 3D view on it", async ({ page }) => {
    const said = async (summary: string): Promise<string> => {
      await openHarness(page, {
        mode: "summary",
        summary,
        live: true,
        overview: true,
        automations: true,
        people: true,
      });
      const state = page.getByTestId("summary-state");
      await expect(state).not.toHaveText("");
      return (await state.textContent()) ?? "";
    };
    expect(await said("people")).toBe("2 at home · In Kitchen");
    expect(await said("upkeep")).toBe("2 tasks due · Clean the filter (Washer)");
    expect(await said("automations")).toMatch(/^3 on of 3 · \d ran today$/);
    expect(await said("robots")).toBe("No robot vacuum");
    expect(await said("network")).toBe("No Zigbee network");
    await said("upkeep");
    await page.getByTestId("summary-upkeep").click();
    await expect(page).toHaveURL(/\/domotwin\/3d\?layer=upkeep$/);
    // The people: the 3D view, where they are drawn.
    await said("people");
    await page.getByTestId("summary-people").click();
    await expect(page).toHaveURL(/\/domotwin\/3d$/);
    // Shown to administrators only: someone else is not told which rooms they are in.
    await openHarness(page, {
      mode: "summary",
      summary: "people",
      live: true,
      overview: true,
      people: true,
      peopleShown: "admins",
      admin: false,
    });
    // Once the people's settings are read, still no room.
    await page.waitForFunction(() => {
      const card = document.querySelector("domotwin-summary-card");
      const body = card?.shadowRoot?.querySelector<HTMLElement & { people?: unknown }>(
        "domotwin-summary-body",
      );
      return body?.people !== undefined;
    });
    await expect(page.getByTestId("summary-state")).toHaveText("2 at home");
    // Without a DomoTwin panel to open, it only says.
    await openHarness(page, {
      mode: "summary",
      summary: "upkeep",
      live: true,
      overview: true,
      noPanel: true,
    });
    await expect(page.getByTestId("summary-state")).toHaveText(/^2 tasks due/);
    await expect(page.locator("domotwin-summary-card button")).toHaveCount(0);
    // In French, for someone who is not an administrator.
    await openHarness(page, {
      mode: "summary",
      summary: "network",
      live: true,
      overview: true,
      zha: true,
      admin: false,
      lang: "fr",
    });
    await expect(page.getByTestId("summary-state")).toHaveText("Pour les administrateurs");
  });

  test("the network's summary reads the mesh", async ({ page }) => {
    await openHarness(page, { mode: "summary", summary: "network", live: true, zha: true });
    await expect(page.getByTestId("summary-state")).toHaveText(/^\d+ devices · /);
  });
});
