import { expect, test } from "@playwright/test";

import type { Plural } from "../src/i18n";

import { pack as arabic } from "../src/i18n/lang/ar";
import { pack as german } from "../src/i18n/lang/de";
import { pack as japanese } from "../src/i18n/lang/ja";
import { fromMenu, openHarness, viewState } from "./fixtures";

/** A plural message as the language counts `count`. */
function plural(language: string, forms: Plural, count: number): string {
  const form = forms[new Intl.PluralRules(language).select(count)] ?? forms.other;
  return form.replace("{count}", String(count));
}

test.describe("more languages (M21, D-081)", () => {
  test("German is loaded when Home Assistant speaks it, and the view speaks it", async ({
    page,
  }) => {
    const loaded: string[] = [];
    page.on("request", (request) => loaded.push(request.url()));
    await openHarness(page, { lang: "de" });
    const rooms = plural("de", german.main.view.rooms, 5);
    await expect(page.getByTestId("summary")).toContainText(rooms);
    await expect(page.getByRole("button", { name: german.main.view.show_plan })).toBeVisible();
    await expect(page.locator("domotwin-card")).toHaveAttribute("dir", "ltr");
    // Its own module, not in the first picture's.
    expect(loaded.some((url) => /\/chunks\/de-[A-Z0-9]+\.js/.test(url))).toBe(true);
  });

  test("an English home loads no other language", async ({ page }) => {
    const loaded: string[] = [];
    page.on("request", (request) => loaded.push(request.url()));
    await openHarness(page);
    await expect(page.getByTestId("summary")).toBeVisible();
    expect(
      loaded.filter((url) =>
        /\/chunks\/(de|es|it|nl|pt|pt-BR|ar|zh-Hans|ja|ko)-[A-Z0-9]+\.js/.test(url),
      ),
    ).toEqual([]);
  });

  test("the demo house speaks it too: its name, its storeys, its rooms", async ({ page }) => {
    await openHarness(page, { mode: "panel", lang: "ja" });
    await fromMenu(page, "demo-menu");
    await expect
      .poll(async () => (await viewState(page)).summary?.name)
      .toBe(japanese.demo["Demo house"]);
    const rooms = page.locator("domotwin-view .room-list");
    await expect(rooms.getByRole("button", { name: japanese.demo.Kitchen })).toHaveCount(1);
    await expect(rooms.getByRole("button", { name: "Kitchen", exact: true })).toHaveCount(0);
  });

  test("Arabic is written right to left: the tools on the left, the rooms on the right", async ({
    page,
  }) => {
    await openHarness(page, { mode: "panel", lang: "ar" });
    const rooms = plural("ar", arabic.main.view.rooms, 5);
    await expect(page.getByTestId("summary")).toContainText(rooms);
    await expect(page.locator("domotwin-panel")).toHaveAttribute("dir", "rtl");
    const tools = await page.locator("domotwin-view .tools").first().boundingBox();
    const view = await page.locator("domotwin-view").first().boundingBox();
    expect(tools && view).toBeTruthy();
    if (tools && view) expect(tools.x + tools.width / 2).toBeLessThan(view.x + view.width / 2);
  });
});
