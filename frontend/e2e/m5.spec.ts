import { expect, test, type Page } from "@playwright/test";

import { openHarness, pointOn, settle, viewState } from "./fixtures";

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

/** What the cameras see, as the engine draws it (D-038). */
async function cameraViews(page: Page): Promise<{ id: string; tone: string; focused: boolean }[]> {
  const stats = (await viewState(page)).stats as unknown as {
    cameraViews: { id: string; tone: string; focused: boolean }[];
  };
  return stats.cameraViews;
}

/** How wide what camera `id` sees is on the screen (device pixels). */
function viewWidth(page: Page, id: string): Promise<number> {
  return page.evaluate((element) => {
    const view = (
      window as never as { __view: () => { engine: { cameraViews(): string } } }
    ).__view();
    const views = JSON.parse(view.engine.cameraViews()) as {
      id: string;
      points: [number, number][];
    }[];
    const xs = views.find((v) => v.id === element)?.points.map(([x]) => x) ?? [];
    return xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0;
  }, id);
}

/** Decodes a fresh frame in the page and keeps its pixels as `name`. */
async function keepFrame(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.evaluate(async (key) => {
    const page = window as never as {
      __framePixels: () => Promise<ImageData>;
      __frames?: Record<string, Uint8ClampedArray>;
    };
    page.__frames ??= {};
    page.__frames[key] = (await page.__framePixels()).data;
  }, name);
}

/** The pixels of frame `b` unlike frame `a`'s: their share and their mean colour in each. */
function frameChange(
  page: Page,
  a: string,
  b: string,
): Promise<{ share: number; before: number[]; after: number[] }> {
  return page.evaluate(
    ([from, to]) => {
      const frames = (window as never as { __frames: Record<string, Uint8ClampedArray> }).__frames;
      const x = frames[from];
      const y = frames[to];
      if (!x || !y || x.length !== y.length) throw new Error("no frames to compare");
      let changed = 0;
      const before = [0, 0, 0];
      const after = [0, 0, 0];
      for (let i = 0; i < x.length; i += 4) {
        let d = 0;
        for (let c = 0; c < 3; c += 1) d += Math.abs((x[i + c] ?? 0) - (y[i + c] ?? 0));
        if (d <= 24) continue;
        changed += 1;
        for (let c = 0; c < 3; c += 1) {
          before[c] = (before[c] ?? 0) + (x[i + c] ?? 0);
          after[c] = (after[c] ?? 0) + (y[i + c] ?? 0);
        }
      }
      const mean = (sum: number[]) => sum.map((v) => (changed > 0 ? v / changed : 0));
      return { share: changed / (x.length / 4), before: mean(before), after: mean(after) };
    },
    [a, b] as const,
  );
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

  test("what a camera sees is drawn on the floor, faint until tapped, red while it records", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, { live: true, view: "2d" });
    await ready(page);
    await expect
      .poll(() => cameraViews(page))
      .toEqual([{ id: "bookcase", tone: "on", focused: false }]);
    expect(await viewWidth(page, "bookcase")).toBeGreaterThan(100);
    await keepFrame(page, "faint");
    // The layer menu hides them: the floor as it is.
    await page.getByTestId("layers").click();
    await page.getByTestId("show-cameras").click();
    await expect.poll(() => cameraViews(page)).toEqual([]);
    await keepFrame(page, "none");
    await page.getByTestId("layers").click();
    await page.getByTestId("show-cameras").click();
    await expect.poll(() => cameraViews(page)).toHaveLength(1);
    const faint = await frameChange(page, "none", "faint");
    expect(faint.share).toBeGreaterThan(0.005);
    // Bluer than the floor under it (the accent).
    expect((faint.after[2] ?? 0) - (faint.before[2] ?? 0)).toBeGreaterThan(5);
    // Tapped (here its badge): whole, over more of the floor.
    await page.getByTestId("badges").locator('[data-element="bookcase"]').click();
    await expect
      .poll(() => cameraViews(page))
      .toEqual([{ id: "bookcase", tone: "on", focused: true }]);
    await keepFrame(page, "whole");
    expect((await frameChange(page, "none", "whole")).share).toBeGreaterThan(faint.share);
    // Recording: from blue to red, where the view is (whole, or faint again should the tap's
    // 15 seconds have passed on a slow machine).
    await setState(page, "camera.living_room", "recording");
    await expect.poll(async () => (await cameraViews(page))[0]?.tone).toBe("recording");
    await expect.poll(() => badgesOf(page, "bookcase")).toEqual(["recording"]);
    await keepFrame(page, "recording");
    const red = await frameChange(page, "whole", "recording");
    expect(red.share).toBeGreaterThan(0.005);
    expect(red.after[0] ?? 0).toBeGreaterThan(red.before[0] ?? 0);
    expect(red.after[2] ?? 0).toBeLessThan(red.before[2] ?? 0);
    await setState(page, "camera.living_room", "unavailable");
    await expect.poll(async () => (await cameraViews(page))[0]?.tone).toBe("off");
    // Tapped again, then a piece linked to nothing: faint again at once.
    await page.getByTestId("badges").locator('[data-element="bookcase"]').click();
    await expect.poll(async () => (await cameraViews(page))[0]?.focused).toBe(true);
    const sofa = await pointOn(page, "sofa");
    await page.mouse.click(sofa.x, sofa.y);
    await expect.poll(async () => (await cameraViews(page))[0]?.focused).toBe(false);
  });

  test("a camera's angle of view and reach are set when linking", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, view: "2d" });
    await ready(page);
    await expect.poll(() => cameraViews(page)).toHaveLength(1);
    const wide = await viewWidth(page, "bookcase");
    await page.getByTestId("link-mode").click();
    // What the cameras see and the badges leave the view to the linking.
    await expect.poll(() => cameraViews(page)).toEqual([]);
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
    await editor.getByTestId("link-fov").fill("12a");
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
    await expect.poll(() => cameraViews(page)).toHaveLength(1);
    await expect.poll(() => viewWidth(page, "bookcase")).toBeLessThan(wide);
  });
});
