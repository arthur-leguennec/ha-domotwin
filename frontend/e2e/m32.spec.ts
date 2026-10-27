import { expect, test, type Page } from "@playwright/test";

import { openHarness, pointOn, settle, viewState } from "./fixtures";

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

/** What was asked of the (mocked) Home Assistant. */
function calls(page: Page): Promise<{ type: string }[]> {
  return page.evaluate(() => (window as never as { __calls: { type: string }[] }).__calls);
}

/** Whether the engine draws frames on its own now (a pulse running). */
function animating(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as never as { __view: () => { engine: { layersAnimating: boolean } } }).__view()
        .engine.layersAnimating,
  );
}

/** A point of the view (page coordinates) on a wire drawn, away from linked pieces. */
async function pointOnWire(page: Page): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(() => {
    const view = (
      window as never as {
        __view: () => {
          engine: {
            automationAt(x: number, y: number): string;
            pick(x: number, y: number): { id: string } | undefined;
          };
          bindings?: { elements: Record<string, { entities: unknown[] } | undefined> };
          canvas: HTMLCanvasElement;
          shadowRoot: ShadowRoot;
        };
      }
    ).__view();
    const canvas = view.canvas;
    const rect = canvas.getBoundingClientRect();
    const k = canvas.clientWidth / canvas.width;
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        if (!view.engine.automationAt(x, y)) continue;
        const piece = view.engine.pick(x, y);
        if (piece && (view.bindings?.elements[piece.id]?.entities.length ?? 0) > 0) continue;
        const top = view.shadowRoot.elementFromPoint(rect.left + x * k, rect.top + y * k);
        if (top === canvas) return { x: rect.left + x * k, y: rect.top + y * k };
      }
    }
    return undefined;
  });
  if (!found) throw new Error("no wire on screen");
  return found;
}

test.describe('"Why?" (D-059)', () => {
  test("a lamp lit by an automation the door set off, its trace, its Activity, in 3D", async ({
    page,
  }) => {
    await openHarness(page, { live: true, why: true });
    await settle(page);
    await longPress(page, await pointOn(page, "spot-hall-1"));
    const sheet = page.locator("domotwin-controls");
    const why = sheet.getByTestId("why");
    // Nothing is asked of the logbook until "Why?" is.
    expect((await calls(page)).filter((c) => c.type === "logbook/get_events")).toEqual([]);
    await why.getByTestId("why-ask").click();
    const steps = why.locator("li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Entrance door contact: on");
    await expect(steps.nth(0)).toContainText("5 minutes ago");
    await expect(steps.nth(1)).toContainText("Hall light at the door");
    await expect(steps.nth(1)).toContainText("Automation that ran");
    await expect(steps.nth(2)).toContainText("Hall spots: on");
    // The run's trace, for an administrator.
    await expect(
      steps.nth(1).getByRole("link", { name: "Trace of Hall light at the door" }),
    ).toHaveAttribute("href", "/config/automation/trace/1004?run_id=run-1");
    // Drawn in the home: from the door to the hall's spots, a pulse along the wire.
    await why.getByTestId("why-show").click();
    await expect(sheet).toHaveCount(0);
    const chip = page.getByTestId("why-wires");
    await expect(chip).toContainText("Why: Hall spots");
    const wires = page.locator("domotwin-why");
    await expect(wires.locator(".end")).toHaveCount(2);
    await expect.poll(() => animating(page)).toBe(true);
    await expect.poll(() => animating(page), { timeout: 10_000 }).toBe(false);
    // A tap on the wire names the automation it went through.
    const wire = await pointOnWire(page);
    await page.mouse.click(wire.x, wire.y);
    await expect(chip).toContainText("Hall light at the door");
    // Hidden.
    await chip.getByRole("button", { name: "Hide why" }).click();
    await expect(wires).toHaveCount(0);
    expect((await viewState(page)).summary).toBeTruthy();
    // Home Assistant's Activity on the same chain.
    await longPress(page, await pointOn(page, "spot-hall-1"));
    await page.locator("domotwin-controls").getByTestId("why-ask").click();
    await page.locator("domotwin-controls").getByTestId("why-activity").click();
    const address = new URL(page.url());
    expect(address.pathname).toBe("/logbook");
    expect(address.searchParams.get("entity_id")).toBe(
      "binary_sensor.entrance_door_contact,automation.hall_light_at_the_door,light.hall_spots",
    );
    expect(address.searchParams.get("start_date")).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("someone in the app, nobody's doing, in French, for a user who is not an admin", async ({
    page,
  }) => {
    await openHarness(page, { live: true, why: true, admin: false, lang: "fr" });
    await settle(page);
    await longPress(page, await pointOn(page, "floor-lamp"));
    let why = page.locator("domotwin-controls").getByTestId("why");
    await why.getByTestId("why-ask").click();
    const steps = why.locator("li");
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toContainText("Un utilisateur de Home Assistant");
    await expect(steps.nth(0)).toContainText("Demandé dans Home Assistant : light.turn_on");
    await expect(steps.nth(1)).toContainText("Living room floor lamp : on");
    await expect(why.getByRole("link")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // The kitchen's light, switched off on its own switch.
    await longPress(page, await pointOn(page, "ceiling-kitchen"));
    why = page.locator("domotwin-controls").getByTestId("why");
    await why.getByTestId("why-ask").click();
    await expect(why.locator("li").first()).toContainText(
      "Personne, à la connaissance de Home Assistant",
    );
    await page.keyboard.press("Escape");
    // A sensor that measures: Home Assistant's logbook never has it, nothing to ask.
    await longPress(page, await pointOn(page, "fridge"));
    await expect(page.locator("domotwin-controls")).toBeVisible();
    await expect(page.locator("domotwin-controls").getByTestId("why")).toHaveCount(0);
    // Neither the traces nor Home Assistant's users were asked: an administrator's.
    const asked = (await calls(page)).map((c) => c.type);
    expect(asked).not.toContain("trace/contexts");
    expect(asked).not.toContain("config/auth/list");
  });

  test("the demo house says who switched its lamp on", async ({ page }) => {
    await openHarness(page, { demo: true });
    await expect.poll(async () => (await viewState(page)).summary?.name).toBe("Demo house");
    await settle(page);
    await longPress(page, await pointOn(page, "floor-lamp"));
    const sheet = page.locator("domotwin-controls");
    // As the house opened: set by the demo's day.
    await sheet.getByTestId("why-ask").click();
    const steps = sheet.getByTestId("why").locator("li");
    await expect(steps.first()).toContainText("The demo house’s day");
    // Switched on by the visitor: asked again as it changes.
    await sheet.getByRole("switch", { name: "Floor lamp" }).click();
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toContainText("E2E");
    await expect(steps.nth(0)).toContainText("Asked in Home Assistant");
    await expect(steps.nth(1)).toContainText("Floor lamp: on");
    // Home Assistant's own pages show the home, not the demo: no Activity, no trace.
    await expect(sheet.getByTestId("why-activity")).toHaveCount(0);
    await expect(sheet.getByTestId("why").getByRole("link")).toHaveCount(0);
    // Nothing reached the home's logbook.
    expect((await calls(page)).filter((c) => c.type === "logbook/get_events")).toEqual([]);
  });
});
