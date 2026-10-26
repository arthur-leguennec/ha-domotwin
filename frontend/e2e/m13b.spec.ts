import { expect, test, type Page } from "@playwright/test";

import { openHarness } from "./fixtures";

/** The boxes of the rooms' names shown. */
async function nameBoxes(
  page: Page,
): Promise<{ room: string; kind: string; compact: boolean; box: DOMRect }[]> {
  return page.evaluate(() => {
    const view = (window as never as { __view: () => HTMLElement }).__view();
    return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".room-name") ?? [])].map(
      (element) => ({
        room: element.dataset.room ?? "",
        kind: element.dataset.kind ?? "",
        compact: element.classList.contains("compact"),
        box: element.getBoundingClientRect().toJSON() as DOMRect,
      }),
    );
  });
}

test.describe("phones and crowded names (M13b)", () => {
  test("the panel fits a phone: no sideways scroll, the buttons keep their icons", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openHarness(page, { mode: "panel" });
    await expect(page.getByTestId("summary")).toBeVisible();
    const sizes = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }));
    expect(sizes.page).toBeLessThanOrEqual(sizes.window);
    const toolbar = page.locator("domotwin-panel .toolbar");
    for (const label of await toolbar.locator(".label").all()) await expect(label).toBeHidden();
    // Every button stays on the screen, named for screen readers and tooltips, and they leave
    // room for Home Assistant's menu button (48 px, not in the harness).
    const boxes = [];
    for (const button of await toolbar.locator("button.action").all()) {
      const box = await button.boundingBox();
      if (!box) throw new Error("a button is not drawn");
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(await button.getAttribute("aria-label")).toBeTruthy();
      boxes.push(box);
    }
    const first = boxes[0];
    const last = boxes[boxes.length - 1];
    if (!first || !last) throw new Error("no button");
    expect(last.x + last.width - first.x).toBeLessThanOrEqual(360 - 48 - 16);
    // The import and the storeys wait in the More menu.
    await page.getByTestId("more").click();
    await expect(page.getByTestId("more-import")).toBeVisible();
    await expect(page.getByTestId("more-storeys")).toBeVisible();
    await page.getByTestId("more").click();
    // A wide window keeps the names, and every button.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(toolbar.locator(".label").first()).toBeVisible();
    await expect(page.getByTestId("storeys-manage")).toBeVisible();
  });

  test("the rooms' names show their kind and never cover one another", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect.poll(async () => (await nameBoxes(page)).length).toBeGreaterThan(0);
    const names = await nameBoxes(page);
    const kinds = Object.fromEntries(names.map((n) => [n.room, n.kind]));
    expect(kinds.living).toBe("living");
    expect(names.find((n) => n.room === "living")?.compact).toBe(false);
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        const apart =
          a.box.right <= b.box.left ||
          b.box.right <= a.box.left ||
          a.box.bottom <= b.box.top ||
          b.box.bottom <= a.box.top;
        expect(apart, `${a.room} and ${b.room}`).toBe(true);
      }
    }
  });

  test("closets' and small rooms' names are a choice of the layers' menu", async ({ page }) => {
    // The upper floor's dressing room is a closet: left out unless asked for.
    await openHarness(page, { storeys: 2, storey: "storey-2" });
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect.poll(async () => (await nameBoxes(page)).length).toBeGreaterThan(0);
    const rooms = async () => (await nameBoxes(page)).map((n) => n.room).sort();
    expect(await rooms()).not.toContain("up-dressing");
    expect(await rooms()).toContain("up-office");
    await page.getByRole("button", { name: "Layers" }).click();
    const small = page.getByTestId("show-small-rooms");
    await expect(small).toHaveAttribute("aria-checked", "false");
    await small.click();
    await expect.poll(rooms).toContain("up-dressing");
    expect((await nameBoxes(page)).find((n) => n.room === "up-dressing")?.kind).toBe("closet");
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByTestId("show-small-rooms")).toHaveAttribute("aria-checked", "true");
    // A layer showing values has no names: no choice either.
    await page.locator('[data-layer="temperature"]').click();
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.locator('[data-layer="temperature"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("show-small-rooms")).toHaveCount(0);
  });

  test("the buttons' names give way when they do not fit, in any language", async ({ page }) => {
    // French names are longer: at 940 px they do not fit, and every button stays on the screen.
    await page.setViewportSize({ width: 940, height: 700 });
    await openHarness(page, { mode: "panel", lang: "fr" });
    await expect(page.getByTestId("summary")).toBeVisible();
    const toolbar = page.locator("domotwin-panel .toolbar");
    await expect(toolbar.locator(".label").first()).toBeHidden();
    const more = await page.getByTestId("more").boundingBox();
    if (!more) throw new Error("no More button");
    expect(more.x + more.width).toBeLessThanOrEqual(940);
    expect(await page.getByTestId("storeys-manage").getAttribute("title")).toBe("Étages");
    // Wider, they come back.
    await page.setViewportSize({ width: 1400, height: 700 });
    await expect(toolbar.locator(".label").first()).toBeVisible();
    // On a phone, linking: no More menu, the import stays in the toolbar.
    await page.setViewportSize({ width: 360, height: 700 });
    await page.getByTestId("link-mode").click();
    await expect(page.getByTestId("more")).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "Importer un plan" })).toBeVisible();
  });

  test("on a phone without a plan, the import stays in the toolbar", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await openHarness(page, { mode: "panel", plan: "none" });
    const toolbar = page.locator("domotwin-panel .toolbar");
    await expect(toolbar.getByRole("button", { name: "Import plan" })).toBeVisible();
    await expect(page.getByTestId("more")).toHaveCount(0);
  });
});
