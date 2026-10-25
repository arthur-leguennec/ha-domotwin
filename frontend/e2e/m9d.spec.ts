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

/** The messages of a type the frontend sent to the mocked Home Assistant. */
function sent(page: Page, type: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (type) =>
      (window as never as { __calls: { type: string }[] }).__calls.filter(
        (call) => call.type === type,
      ) as Record<string, unknown>[],
    type,
  );
}

/** The kinds of the badges over a piece. */
function badgeKinds(page: Page, piece: string): Promise<string[]> {
  return page
    .locator(`[data-testid="badges"] [data-element="${piece}"] [data-kind]`)
    .evaluateAll((badges) => badges.map((badge) => badge.getAttribute("data-kind") ?? ""));
}

test.describe("upkeep cards (D-033)", () => {
  test("a card is written for a piece linked to nothing", async ({ page }) => {
    await page.clock.setSystemTime(new Date("2026-10-24T10:00:00"));
    await openHarness(page, { live: true, upkeep: true });
    await settle(page);
    // The sofa is linked to nothing: an administrator gets its own sheet.
    await longPress(page, await pointOn(page, "sofa"));
    const sheet = page.getByTestId("piece");
    await expect(sheet).toContainText("No upkeep card for this piece.");
    await sheet.getByTestId("upkeep-add").click();
    const form = sheet.getByTestId("upkeep-form");
    await form.locator('input[name="make"]').fill("Fictional Sofas");
    await form.locator('input[name="installed"]').fill("2025-04-01");
    await form.locator('input[name="manual"]').fill("javascript:alert(1)");
    await form.getByTestId("upkeep-add-task").click();
    await form.locator('input[name="task-name"]').fill("Vacuum the cushions");
    await form.locator('input[name="task-every"]').fill("1");
    await form.locator('input[name="task-last-done"]').fill("2026-10-20");
    // Not a link DomoTwin keeps.
    await form.getByTestId("upkeep-save").click();
    await expect(sheet.getByRole("alert")).toContainText("The manual is a path");
    await form.locator('input[name="manual"]').fill("/local/manuals/sofa.pdf");
    await form.getByTestId("upkeep-save").click();
    await expect(sheet.getByTestId("upkeep-form")).toHaveCount(0);
    await expect(sheet).toContainText("Fictional Sofas");
    const task = sheet.locator('[data-task="task-1"]');
    await expect(task).toContainText("Vacuum the cushions");
    await expect(task).toContainText("every month");
    await expect(task).toContainText("due in 27 days");
    await expect(sheet.getByRole("link", { name: "Open the manual" })).toHaveAttribute(
      "href",
      "/local/manuals/sofa.pdf",
    );
    const saves = await sent(page, "domotwin/upkeep/save");
    expect(saves.at(-1)?.pieces).toEqual({
      sofa: {
        make: "Fictional Sofas",
        installed: "2025-04-01",
        manual: "/local/manuals/sofa.pdf",
        tasks: [
          {
            id: "task-1",
            name: "Vacuum the cushions",
            every: 1,
            unit: "months",
            last_done: "2026-10-20",
          },
        ],
      },
    });
    // Its room's panel a tap away.
    await sheet.getByTestId("piece-room").click();
    await expect(page.getByTestId("room")).toBeVisible();
  });

  test("a task falls due, shows on its piece, and is done", async ({ page }) => {
    await page.clock.setSystemTime(new Date("2026-10-10T10:00:00"));
    await openHarness(page, { live: true, upkeep: true });
    await settle(page);
    // 10 October: the washing machine's filter is due on the 20th, the fridge's coils in 22 days.
    await expect.poll(() => badgeKinds(page, "washer")).toContain("upkeep_due");
    expect(await badgeKinds(page, "fridge")).not.toContain("upkeep_due");
    // Two weeks later: the filter is late, the coils due soon, the warranty ends in 17 days.
    await page.clock.setSystemTime(new Date("2026-10-24T10:00:00"));
    await page.evaluate(() => {
      (window as never as { __setState(id: string, state: string): void }).__setState(
        "sensor.fridge_power",
        "3",
      );
    });
    await expect.poll(() => badgeKinds(page, "fridge")).toContain("upkeep_due");
    await expect.poll(() => badgeKinds(page, "washer")).toContain("upkeep_overdue");
    // A tap on the badge opens the card, with the fridge's controls.
    await page.locator('[data-testid="badges"] [data-element="fridge"]').click();
    const card = page.locator("domotwin-controls").getByTestId("upkeep");
    await expect(card.locator('[data-task="coils"]')).toContainText("due in 8 days");
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    // The list of the upkeep layer: the soonest first, with Done.
    await chooseLayer(page, "upkeep");
    const list = page.getByTestId("upkeep-list");
    const lines = list.locator("li");
    await expect(lines.first()).toHaveAttribute("data-piece", "washer");
    await expect(lines.first()).toHaveClass(/overdue/);
    await expect(lines.first()).toContainText("4 days late");
    const coils = list.locator('li[data-piece="fridge"][data-task="coils"]');
    await expect(coils).toHaveClass(/due/);
    await coils.getByRole("button", { name: "Clean the condenser coils done today" }).click();
    await expect(coils).toHaveClass(/fine/);
    await expect(coils).toContainText("due in 182 days");
    expect(await sent(page, "domotwin/upkeep/done")).toEqual([
      { type: "domotwin/upkeep/done", piece: "fridge", task: "coils" },
    ]);
    await expect.poll(() => badgeKinds(page, "fridge")).not.toContain("upkeep_due");
    // A tap on a line frames its piece.
    await lines.first().locator("button.line").click();
    // Administrators set how early a task is due soon.
    await list.getByTestId("upkeep-lead").fill("30");
    await list.getByTestId("upkeep-lead").dispatchEvent("change");
    await expect
      .poll(async () => (await sent(page, "domotwin/upkeep/save")).at(-1))
      .toEqual({
        type: "domotwin/upkeep/save",
        pieces: {},
        lead_days: 30,
      });
  });

  test("others see the cards and say what is done, without editing", async ({ page }) => {
    await page.clock.setSystemTime(new Date("2026-10-24T10:00:00"));
    await openHarness(page, { live: true, upkeep: true, admin: false });
    await settle(page);
    // The fridge is linked: its card shows with its controls.
    await longPress(page, await pointOn(page, "fridge"));
    const card = page.locator("domotwin-controls").getByTestId("upkeep");
    await expect(card).toContainText("Cold & Co");
    await expect(card).toContainText("FR-7");
    await expect(card.getByTestId("upkeep-edit")).toHaveCount(0);
    await card.getByRole("button", { name: "Clean the condenser coils done today" }).click();
    await expect.poll(async () => (await sent(page, "domotwin/upkeep/done")).length).toBe(1);
    // A piece with nothing to show still opens its room's panel.
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await longPress(page, await pointOn(page, "sofa"));
    await expect(page.getByTestId("room")).toBeVisible();
  });

  test("an integration without upkeep shows no layer and no card", async ({ page }) => {
    await openHarness(page, { live: true, upkeep: false });
    await page.getByTestId("layers").click();
    await expect(page.locator('[data-layer="upkeep"]')).toHaveCount(0);
  });

  test("the upkeep layer tints the pieces", async ({ page }) => {
    await page.clock.setSystemTime(new Date("2026-10-24T10:00:00"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, { live: true, upkeep: true, layer: "upkeep" });
    await expect(page.getByTestId("upkeep-list")).toBeVisible();
    await settle(page);
    expect(await canvasPng(page)).toMatchSnapshot("upkeep-day.png", { maxDiffPixelRatio: 0.01 });
  });
});
