import { expect, test, type Page } from "@playwright/test";

import { canvasPng, openHarness, pointOn, settle } from "./fixtures";

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

/** Opens the layer menu and picks a layer. */
async function chooseLayer(page: Page, layer: string): Promise<void> {
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator(`[data-layer="${layer}"]`).click();
}

/** Whether the engine draws frames on its own now (a pulse running). */
function animating(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as never as { __view: () => { engine: { layersAnimating: boolean } } }).__view()
        .engine.layersAnimating,
  );
}

/** A point of the view (page coordinates) where a wire of the automations is. */
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
    for (let y = 0; y < canvas.height; y += 5) {
      for (let x = 0; x < canvas.width; x += 5) {
        if (!view.engine.automationAt(x, y)) continue;
        // Not over a linked piece: a tap there acts on the piece.
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

test.describe("automation wires (D-032)", () => {
  test("a piece's automations, their wires and a run", async ({ page }) => {
    await openHarness(page, { live: true, automations: true });
    await settle(page);
    const lamp = await pointOn(page, "floor-lamp");
    await longPress(page, lamp);
    const section = page.locator("domotwin-controls").getByTestId("automations");
    // The floor lamp is acted on by "Evening lights"; its room's area by "Movie time".
    await expect(section.locator("[data-automation]")).toHaveCount(2);
    const evening = section.locator('[data-automation="automation.evening_lights"]');
    await expect(evening).toContainText("Evening lights");
    await expect(evening).toContainText("Acted on");
    await expect(evening).toContainText("ran 60 minutes ago");
    await expect(evening.getByRole("link", { name: "Edit Evening lights" })).toHaveAttribute(
      "href",
      "/config/automation/edit/1001",
    );
    await expect(evening.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await section.getByTestId("show-wires").click();
    // The panel closes; the wires and their ends are drawn.
    await expect(page.locator("domotwin-controls")).toHaveCount(0);
    const chip = page.getByTestId("wires");
    await expect(chip).toContainText("Wires of 2 automations");
    const wires = page.locator("domotwin-wires");
    await expect(wires.locator(".label", { hasText: "Sun" })).toHaveCount(1);
    await expect(wires.locator(".label", { hasText: "Template" })).toHaveCount(1);
    await expect(wires.locator(".end").first()).toBeVisible();
    await settle(page);
    expect(await animating(page)).toBe(false);
    // It runs: a pulse along its wires, then nothing moves.
    await page.evaluate(() => {
      (window as never as { __runAutomation: (id: string) => void }).__runAutomation(
        "automation.evening_lights",
      );
    });
    await expect.poll(() => animating(page)).toBe(true);
    await expect.poll(() => animating(page), { timeout: 10_000 }).toBe(false);
    // The floor lamp, an end of the wires, still turns on and off with a tap.
    await page.mouse.click(lamp.x, lamp.y);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as never as { __calls: { type: string; service?: string }[] }).__calls.filter(
              (call) => call.type === "call_service",
            ).length,
        ),
      )
      .toBe(1);
    await expect(chip).toContainText("Wires of 2 automations");
    // A tap on a wire picks its automation out.
    const wire = await pointOnWire(page);
    await page.mouse.click(wire.x, wire.y);
    await expect(chip).toContainText(/Evening lights|Movie time/);
    // Every automation of the home, from the layer menu, takes over from the panel's.
    await chooseLayer(page, "automations");
    await expect(chip).toContainText("Wires of 3 automations");
    // Hidden.
    await chip.getByRole("button", { name: "Hide the wires" }).click();
    await expect(wires).toHaveCount(0);
  });

  test("others see the list without wires or edit links", async ({ page }) => {
    await openHarness(page, { live: true, automations: true, admin: false });
    await settle(page);
    await longPress(page, await pointOn(page, "floor-lamp"));
    const section = page.locator("domotwin-controls").getByTestId("automations");
    await expect(section.locator("[data-automation]")).toHaveCount(2);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByTestId("show-wires")).toHaveCount(0);
    await expect(section).toContainText("Their wires need an administrator");
    // Nor the layer of every automation.
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="automations"]')).toHaveCount(0);
  });

  test("every automation of the home, from the layer menu", async ({ page }) => {
    await openHarness(page, { live: true, automations: true });
    await chooseLayer(page, "automations");
    const chip = page.getByTestId("wires");
    await expect(chip).toContainText("Wires of 3 automations");
    const wires = page.locator("domotwin-wires");
    // What has no piece floats above the home: the time, the notification, what a template picks.
    for (const label of ["Time", "notify.phone", "Decided when it runs"]) {
      await expect(wires.locator(".label", { hasText: label })).toHaveCount(1);
    }
    await expect(wires.locator(".label.dynamic")).toHaveCount(1);
    await chip.getByRole("button", { name: "Hide the wires" }).click();
    await expect(wires).toHaveCount(0);
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="off"]')).toHaveAttribute("aria-checked", "true");
  });

  test("many automations are bundled by room", async ({ page }) => {
    await openHarness(page, { live: true, automations: 50 });
    await chooseLayer(page, "automations");
    await expect(page.getByTestId("wires")).toContainText("50 automations, bundled by room");
  });

  for (const look of ["day", "neon", "blueprint"] as const) {
    test(`looks right in the ${look} look`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openHarness(page, { live: true, automations: true, theme: look });
      await chooseLayer(page, "automations");
      await expect(page.getByTestId("wires")).toContainText("Wires of 3 automations");
      await settle(page);
      expect(await canvasPng(page)).toMatchSnapshot(`automations-${look}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
