import { expect, test, type Page } from "@playwright/test";

import { canvasPng, elementPoint, openHarness, pointOn, settle, stage } from "./fixtures";

/** Opens the layer menu and picks a layer. */
async function chooseLayer(page: Page, layer: string): Promise<void> {
  await page.getByTestId("layers").click();
  await page.getByTestId("layer-menu").locator(`[data-layer="${layer}"]`).click();
}

/** A point of the view (CSS pixels from the page's top left) where a wire of the map is. */
async function pointOnWire(page: Page): Promise<{ x: number; y: number }> {
  const box = await stage(page).boundingBox();
  if (!box) throw new Error("no stage");
  const found = await page.evaluate(() => {
    const view = (
      window as never as {
        __view: () => {
          engine: {
            networkAt(x: number, y: number): string;
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
    for (let y = 0; y < canvas.height; y += 6) {
      for (let x = 0; x < canvas.width; x += 6) {
        if (!view.engine.networkAt(x, y)) continue;
        // Not over a linked piece: a tap there acts on the piece.
        const piece = view.engine.pick(x, y);
        if (piece && (view.bindings?.elements[piece.id]?.entities.length ?? 0) > 0) continue;
        // Only where the canvas itself takes the tap (not under the sheet or a marker).
        const top = view.shadowRoot.elementFromPoint(rect.left + x * k, rect.top + y * k);
        if (top === canvas) return { x: x * k, y: y * k };
      }
    }
    return undefined;
  });
  if (!found) throw new Error("no wire on screen");
  return { x: box.x + found.x, y: box.y + found.y };
}

test.describe("network map (D-031)", () => {
  test("is offered to administrators with ZHA only", async ({ page }) => {
    await openHarness(page, { live: true });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="power"]')).toBeVisible();
    await expect(page.locator('[data-layer="network"]')).toHaveCount(0);
    await openHarness(page, { live: true, zha: true, admin: false });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="network"]')).toHaveCount(0);
    await openHarness(page, { live: true, zha: true });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="network"]')).toHaveText("Zigbee network");
  });

  test("draws the mesh with its health, a device and a link tapped", async ({ page }) => {
    await openHarness(page, { live: true, zha: true });
    await chooseLayer(page, "network");
    const sheet = page.getByTestId("network");
    await expect(sheet).toBeVisible();
    const health = page.getByTestId("network-health");
    await expect(health).toContainText("6 devices");
    await expect(health).toContainText("1 weak link");
    await expect(health).toContainText("1 device not seen for a day");
    await expect(health).toContainText(
      "Bathroom reaches the mesh only through a weak link: a router here would help.",
    );
    // Placed nowhere: the garden sensor; in the card it cannot be placed (no link editor).
    const loose = page.getByTestId("network-not-placed");
    await expect(loose).toContainText("Garden sensor");
    await expect(loose.getByRole("button")).toHaveCount(0);
    // Five markers, the coordinator drawn apart.
    const markers = page.locator("domotwin-network .node");
    await expect(markers).toHaveCount(5);
    const coordinator = page.locator("domotwin-network .node.coordinator");
    await expect(coordinator).toHaveCount(1);
    // Without a quality of its own, the coordinator is still the large ring.
    expect((await coordinator.boundingBox())?.width ?? 0).toBeGreaterThan(30);
    await expect(page.locator("domotwin-network .node.stale")).toHaveCount(1);
    // A device tapped: its details and its neighbours, best first.
    await page.locator('domotwin-network .node[data-device="00:12:4b:00:00:00:00:02"]').click();
    const details = page.getByTestId("network-device");
    await expect(details).toContainText("Living room floor lamp");
    await expect(sheet).toContainText("Router");
    await expect(sheet.locator("ul").first()).toContainText("Coordinator");
    // A link tapped: its ends and its quality.
    await settle(page);
    const wire = await pointOnWire(page);
    await page.mouse.click(wire.x, wire.y);
    await expect(page.getByTestId("network-link")).toBeVisible();
    await expect(sheet).toContainText("↔");
    await expect(page.getByTestId("network-reported").locator("dt")).toHaveCount(2);
    // Rescan: ZHA is asked, and it says it takes minutes.
    await page.getByTestId("network-rescan").click();
    await expect(sheet).toContainText("it takes a few minutes");
    const asked = await page.evaluate(() =>
      (window as never as { __calls: { type: string }[] }).__calls.some(
        (c) => c.type === "zha/topology/update",
      ),
    );
    expect(asked).toBe(true);
    // Walking, the map steps aside; back above, it comes back.
    await page.getByTestId("walk").click();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("walk").click();
    await expect(sheet).toBeVisible();
    // Another layer: the map goes.
    await chooseLayer(page, "off");
    await expect(sheet).toHaveCount(0);
  });

  test("a device placed nowhere is placed from the panel", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, zha: true });
    await expect(page.getByTestId("summary")).toBeVisible();
    await chooseLayer(page, "network");
    const loose = page.getByTestId("network-not-placed");
    await loose.getByRole("button", { name: "Place Garden sensor in the home" }).click();
    await expect(page.getByTestId("toast")).toContainText(
      "Tap the piece, door or window where Garden sensor is.",
    );
    // A room is not a piece: the request waits for one.
    const bedroom = await pointOn(page, "bedroom");
    await page.mouse.click(bedroom.x, bedroom.y);
    const editor = page.locator("domotwin-link");
    await expect(editor).toHaveCount(0);
    // The sensor is by the kitchen window.
    const pane = await pointOn(page, "win-kitchen-1");
    await page.mouse.click(pane.x, pane.y);
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("sensor.garden_temperature");
    // Its signal is a diagnostic entity: not linked.
    await expect(editor).not.toContainText("sensor.garden_sensor_lqi");
  });

  test("a map closed before ZHA answers leaves nothing drawn", async ({ page }) => {
    await openHarness(page, { live: true, zha: true });
    await page.evaluate(() => {
      const w = window as never as { __zhaHold?: Promise<void>; __zhaRelease?: () => void };
      w.__zhaHold = new Promise((done) => {
        w.__zhaRelease = done;
      });
    });
    await chooseLayer(page, "network");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as never as { __calls: { type: string }[] }).__calls.some(
            (c) => c.type === "zha/devices",
          ),
        ),
      )
      .toBe(true);
    await chooseLayer(page, "off");
    await page.evaluate(() => {
      (window as never as { __zhaRelease: () => void }).__zhaRelease();
    });
    await page.waitForTimeout(300);
    const drawn = await page.evaluate(() => {
      const view = (
        window as never as {
          __view: () => {
            engine: { networkAt(x: number, y: number): string; layersAnimating: boolean };
            canvas: HTMLCanvasElement;
          };
        }
      ).__view();
      for (let y = 0; y < view.canvas.height; y += 8) {
        for (let x = 0; x < view.canvas.width; x += 8) {
          if (view.engine.networkAt(x, y)) return "a wire";
        }
      }
      return view.engine.layersAnimating ? "frames" : "nothing";
    });
    expect(drawn).toBe("nothing");
  });

  test("a piece that only stands for a device acts as an unlinked one", async ({ page }) => {
    await openHarness(page, { live: true, zha: true });
    const sideboard = await elementPoint(page, "sideboard");
    await page.mouse.click(sideboard.x, sideboard.y);
    // Its room is framed, as for any piece linked to nothing.
    await expect(page.getByTestId("room-chip")).toBeVisible();
  });

  test("a card set to the network map shows nothing of it to others", async ({ page }) => {
    await openHarness(page, { live: true, zha: true, admin: false, layer: "network" });
    await expect(page.getByTestId("layers")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("domotwin-view")).not.toHaveAttribute("legend");
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="off"]')).toHaveAttribute("aria-checked", "true");
  });

  test.describe("on a dense screen", () => {
    test.use({ deviceScaleFactor: 2 });

    test("markers stand where their pieces are drawn", async ({ page }) => {
      await openHarness(page, { live: true, zha: true });
      await chooseLayer(page, "network");
      const marker = page.locator('domotwin-network .node[data-device="00:12:4b:00:00:00:00:01"]');
      await expect(marker).toBeVisible();
      await settle(page);
      const box = await stage(page).boundingBox();
      const shown = await marker.boundingBox();
      if (!box || !shown) throw new Error("not on screen");
      // The sideboard stands for the coordinator: the engine's point for it, in CSS pixels.
      const point = await page.evaluate(() => {
        const view = (
          window as never as {
            __view: () => {
              engine: { elementPoints(ids: string): string };
              canvas: HTMLCanvasElement;
            };
          }
        ).__view();
        const [x, y] = (
          JSON.parse(view.engine.elementPoints('["sideboard"]')) as { sideboard: [number, number] }
        ).sideboard;
        const k = view.canvas.clientWidth / view.canvas.width;
        return { x: x * k, y: y * k, k };
      });
      expect(point.k).toBeCloseTo(0.5);
      expect(Math.abs(shown.x + shown.width / 2 - (box.x + point.x))).toBeLessThan(2);
      expect(Math.abs(shown.y + shown.height / 2 - (box.y + point.y))).toBeLessThan(2);
    });
  });

  for (const look of ["day", "neon", "blueprint"] as const) {
    test(`looks right in the ${look} look`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openHarness(page, { live: true, zha: true, theme: look });
      await chooseLayer(page, "network");
      await expect(page.locator("domotwin-network .node")).toHaveCount(5);
      await settle(page);
      expect(await canvasPng(page)).toMatchSnapshot(`network-${look}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
