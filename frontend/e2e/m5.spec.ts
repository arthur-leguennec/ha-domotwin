import { expect, test, type Page } from "@playwright/test";

import { openHarness, settle } from "./fixtures";

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId("summary")).toBeVisible();
  await settle(page);
}

function setState(
  page: Page,
  id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  return page.evaluate(
    ([entity, value, extra]) => {
      (
        window as never as {
          __setState: (id: string, state: string, attributes: Record<string, unknown>) => void;
        }
      ).__setState(entity, value, extra);
    },
    [id, state, attributes] as const,
  );
}

/** The badges shown over an element, by kind. */
function badgesOf(page: Page, id: string): Promise<string[]> {
  return page
    .getByTestId("badges")
    .locator(`[data-element="${id}"] .badge`)
    .evaluateAll((spans) => spans.map((span) => span.getAttribute("data-kind") ?? ""));
}

test.describe("devices", () => {
  test("badges show what the devices are doing, and a tap acts like one on the element", async ({
    page,
  }) => {
    await openHarness(page, { live: true });
    await ready(page);
    await expect.poll(() => badgesOf(page, "door-entrance")).toEqual(["unlocked"]);
    await expect.poll(() => badgesOf(page, "tv")).toEqual(["playing"]);
    await expect.poll(() => badgesOf(page, "bookcase")).toEqual(["camera"]);
    expect(await badgesOf(page, "washer")).toEqual([]);
    // The door locks, its lock's battery runs low; the washing machine starts.
    await setState(page, "lock.entrance_door", "locked");
    await setState(page, "sensor.entrance_door_lock_battery", "12");
    await setState(page, "sensor.washing_machine_power", "450");
    await expect.poll(() => badgesOf(page, "door-entrance")).toEqual(["battery_low", "locked"]);
    await expect(
      page.getByTestId("badges").locator('[data-element="door-entrance"]'),
    ).toHaveAttribute("aria-label", "Entrance door: battery low (12 %), Entrance door: locked");
    await expect.poll(() => badgesOf(page, "washer")).toEqual(["running"]);
    await setState(page, "lock.entrance_door", "jammed");
    await expect.poll(() => badgesOf(page, "door-entrance")).toEqual(["jammed", "battery_low"]);
    // A tap on the door's badges: the door's tap (more-info of its lock).
    await page.evaluate(() => {
      document.addEventListener("hass-more-info", (event) => {
        (window as never as { __moreInfo: unknown }).__moreInfo = (
          event as CustomEvent<{ entityId: string }>
        ).detail.entityId;
      });
    });
    await page.getByTestId("badges").locator('[data-element="door-entrance"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as never as { __moreInfo?: string }).__moreInfo))
      .toBe("lock.entrance_door");
    // The layer menu hides them.
    await page.getByTestId("layers").click();
    await page.getByTestId("show-badges").click();
    await expect(page.getByTestId("badges")).toBeHidden();
  });

  test("what a camera sees is drawn on the floor, red while it records", async ({ page }) => {
    await openHarness(page, { live: true, view: "2d" });
    await ready(page);
    const cone = page.getByTestId("cameras").locator('polygon[data-id="bookcase"]');
    await expect(cone).toHaveAttribute("class", "on");
    const box = await cone.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    await setState(page, "camera.living_room", "recording");
    await expect(cone).toHaveAttribute("class", "recording");
    await expect.poll(() => badgesOf(page, "bookcase")).toEqual(["recording"]);
    await setState(page, "camera.living_room", "unavailable");
    await expect(cone).toHaveAttribute("class", "off");
    await page.getByTestId("layers").click();
    await page.getByTestId("show-cameras").click();
    await expect(page.getByTestId("cameras")).toBeHidden();
  });

  test("a camera's angle of view and reach are set when linking", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, view: "2d" });
    await ready(page);
    const cone = page.getByTestId("cameras").locator('polygon[data-id="bookcase"]');
    const wide = (await cone.boundingBox())?.width ?? 0;
    await page.getByTestId("link-mode").click();
    // The cones and badges leave the view to the linking.
    await expect(page.getByTestId("cameras")).toBeHidden();
    const point = await page.evaluate(() => {
      const view = (
        window as never as {
          __view: () => {
            elementPoint(id: string): { x: number; y: number } | undefined;
            elementAt(x: number, y: number): { id: string } | undefined;
          };
        }
      ).__view();
      const centre = view.elementPoint("bookcase");
      if (!centre) return null;
      for (let r = 0; r <= 24; r += 3) {
        for (let dy = -r; dy <= r; dy += 3) {
          for (let dx = -r; dx <= r; dx += 3) {
            const at = { x: centre.x + dx, y: centre.y + dy };
            if (view.elementAt(at.x, at.y)?.id === "bookcase") return at;
          }
        }
      }
      return null;
    });
    if (!point) throw new Error("the bookcase cannot be tapped");
    const stage = await page.locator("domotwin-view").locator(".stage").boundingBox();
    await page.mouse.click((stage?.x ?? 0) + point.x, (stage?.y ?? 0) + point.y);
    const editor = page.locator("domotwin-link");
    await expect(editor.getByText("What the camera sees")).toBeVisible();
    await expect(editor.getByTestId("link-fov")).toHaveValue("100");
    await editor.getByTestId("link-fov").fill("5");
    await expect(editor.getByTestId("link-save")).toBeDisabled();
    await editor.getByTestId("link-fov").fill("40");
    await editor.getByTestId("link-range").fill("");
    await editor.getByTestId("link-save").click();
    await expect(editor).toHaveCount(0);
    const saved = await page.evaluate(() => {
      const calls = (
        window as never as { __calls: { type: string; bindings?: unknown }[] }
      ).__calls.filter((call) => call.type === "domotwin/bindings/save");
      return (calls[calls.length - 1]?.bindings as { elements: Record<string, unknown> }).elements
        .bookcase;
    });
    expect(saved).toEqual({ entities: [{ entity_id: "camera.living_room" }], fov: 40 });
    await page.getByTestId("link-mode").click();
    await expect.poll(async () => (await cone.boundingBox())?.width ?? 0).toBeLessThan(wide);
  });
});
