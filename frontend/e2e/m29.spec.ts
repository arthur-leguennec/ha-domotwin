import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

/** What was asked of the visitor's own (mocked) Home Assistant. */
function realCalls(page: Page): Promise<{ type: string }[]> {
  return page.evaluate(() => (window as never as { __calls: { type: string }[] }).__calls);
}

/** A state in the Home Assistant the view shows: the sandbox's while it is open. */
function shownState(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(
    (id) =>
      (
        window as never as {
          __view: () => { hass: { states: Record<string, { state: string } | undefined> } };
        }
      ).__view().hass.states[id]?.state,
    id,
  );
}

/** A state in the visitor's own Home Assistant. */
function homeState(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(
    (id) =>
      (window as never as { __hass: { states: Record<string, { state: string } | undefined> } })
        .__hass.states[id]?.state,
    id,
  );
}

/** Asked of the home since `before`: only reads, nothing written, no service called. */
async function onlyReads(page: Page, before: number): Promise<void> {
  const calls = (await realCalls(page)).slice(before);
  expect(
    calls.filter(
      (c) =>
        c.type === "call_service" ||
        c.type === "fetch" ||
        /\/(save|add|cancel|done|hide|remove|favourite|replace)$/.test(c.type),
    ),
  ).toEqual([]);
}

/** Goes to `hour`:`minute` with the keyboard on the day's line. */
async function goTo(page: Page, hour: number, minute = 0): Promise<void> {
  const line = page.getByTestId("sandbox-line");
  const time = page.getByTestId("sandbox-time");
  await line.focus();
  await line.press("Home");
  for (let h = 0; h < hour; h += 1) await line.press("PageUp");
  // A day the clocks change has an hour more or less: set right by the clock shown.
  const shown = async () => Number(((await time.textContent()) ?? "").split(":")[0]);
  while ((await shown()) < hour) await line.press("PageUp");
  while ((await shown()) > hour) await line.press("PageDown");
  for (let m = 0; m < minute; m += 5) await line.press("ArrowRight");
  await expect(time).toHaveText(
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  );
}

const OPTIONS = {
  mode: "panel",
  live: true,
  automations: true,
  people: true,
  sandbox: true,
} as const;

test.describe("the sandbox (D-057)", () => {
  test("plays the home's automations on a copy, says what the day did, and touches nothing", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    const lamp = "light.living_room_floor_lamp";
    const lampAtHome = await homeState(page, lamp);
    const before = (await realCalls(page)).length;
    await fromMenu(page, "sandbox-menu");
    const bar = page.getByTestId("sandbox-bar");
    await expect(bar).toContainText("Nothing here reaches a device.");
    await expect(page.getByTestId("sandbox-time")).toHaveText("07:00");
    // The day to play: Alex goes out at nine and is back at six.
    await page.getByTestId("sandbox-day").click();
    const alex = page.locator('[data-person="person.alex"]');
    await alex.getByTestId("sandbox-person-leaves").fill("09:00");
    await alex.getByTestId("sandbox-person-back").fill("18:00");
    await page.getByTestId("sandbox-day-apply").click();
    await expect(page.getByTestId("sandbox-day-sheet")).toHaveCount(0);
    // At nine the lamp is turned off as Alex leaves, and straight back on by the other one.
    await goTo(page, 9, 5);
    expect(await shownState(page, "person.alex")).toBe("not_home");
    expect(await shownState(page, lamp)).toBe("on");
    // The report: the two working against each other, the one set off from outside, and what
    // could not be played.
    await expect(page.getByTestId("sandbox-problems")).toBeVisible();
    await page.getByTestId("sandbox-report").click();
    const report = page.getByTestId("sandbox-report-sheet");
    await expect(report.getByTestId("sandbox-conflicts")).toContainText(
      "Lamp off when Alex goes out made it off at 09:00, then Lamp back on made it on at 09:00.",
    );
    await expect(
      report
        .getByTestId("sandbox-never")
        .locator('[data-owner="automation.doorbell_from_outside"]'),
    ).toContainText("Never set off this day.");
    await expect(
      report
        .getByTestId("sandbox-not-played")
        .locator('[data-owner="automation.doorbell_from_outside"]'),
    ).toContainText("Set off from outside the home's day: mqtt");
    // Goodnight ran at eleven: its notification said, the lamps by the bed switched off.
    const goodnight = report
      .getByTestId("sandbox-ran")
      .locator('[data-owner="automation.goodnight"]');
    await expect(goodnight).toContainText("1 run");
    await expect(goodnight).toContainText("notify.phone: “Goodnight”");
    // A time in the report goes there.
    await goodnight.getByRole("button", { name: "Go to 23:00" }).click();
    await expect(page.getByTestId("sandbox-time")).toHaveText("23:00");
    expect(await shownState(page, "light.bedside_left")).toBe("off");
    // Back to the home, as it was: only read, nothing written, no service called.
    await page.getByTestId("sandbox-leave").click();
    await expect(bar).toHaveCount(0);
    expect(await homeState(page, lamp)).toBe(lampAtHome);
    expect(await homeState(page, "person.alex")).toBe("home");
    await onlyReads(page, before);
  });

  test("plays the day by itself, and a tap is done at that moment with the day going on", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    const before = (await realCalls(page)).length;
    await fromMenu(page, "sandbox-menu");
    await expect(page.getByTestId("sandbox-time")).toHaveText("07:00");
    // An hour a second: the day goes by.
    await page.getByTestId("sandbox-speed").selectOption("60");
    await page.getByTestId("sandbox-play").click();
    await expect(page.getByTestId("sandbox-play")).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await page.getByTestId("sandbox-time").textContent()) ?? "")
      .not.toBe("07:00");
    await page.getByTestId("sandbox-play").click();
    await expect(page.getByTestId("sandbox-play")).toHaveAttribute("aria-pressed", "false");
    await goTo(page, 10);
    // A tap in the sandbox, the day's form open: the lamp switched off by hand, then back on by
    // the automation.
    await page.getByTestId("sandbox-day").click();
    await page.evaluate(async () => {
      const view = (
        window as never as {
          __view: () => {
            hass: { callService(d: string, s: string, data: object, t: object): Promise<unknown> };
          };
        }
      ).__view();
      await view.hass.callService(
        "light",
        "turn_off",
        {},
        { entity_id: "light.living_room_floor_lamp" },
      );
    });
    await expect.poll(() => shownState(page, "light.living_room_floor_lamp")).toBe("on");
    await expect(page.getByTestId("sandbox-calls")).toContainText("10:00 light.turn_off");
    // Playing the day keeps it, until it is forgotten.
    await page.getByTestId("sandbox-day-apply").click();
    await page.getByTestId("sandbox-day").click();
    await expect(page.getByTestId("sandbox-calls")).toContainText("10:00 light.turn_off");
    await page.getByTestId("sandbox-forget").click();
    await expect(page.getByTestId("sandbox-calls")).toHaveCount(0);
    await page.getByTestId("sandbox-day-apply").click();
    await onlyReads(page, before);
  });

  test("the automations' wires pulse as the day plays them, and again after going back", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    await fromMenu(page, "sandbox-menu");
    await page.getByTestId("sandbox-day").click();
    const alex = page.locator('[data-person="person.alex"]');
    await alex.getByTestId("sandbox-person-leaves").fill("09:00");
    await page.getByTestId("sandbox-day-apply").click();
    await page.getByTestId("layers").click();
    await page.getByTestId("layer-menu").locator('[data-layer="automations"]').click();
    await expect(page.getByTestId("wires")).toContainText("Wires of");
    // Each pulse the view asks of its engine.
    await page.evaluate(() => {
      const w = window as never as {
        __pulses: string[];
        __view: () => { engine: { pulseAutomation(id: string, at: number): void } };
      };
      const engine = w.__view().engine;
      const pulse = engine.pulseAutomation.bind(engine);
      w.__pulses = [];
      engine.pulseAutomation = (id, at) => {
        w.__pulses.push(id);
        pulse(id, at);
      };
    });
    const pulses = () =>
      page.evaluate(() => (window as never as { __pulses: string[] }).__pulses.splice(0));
    for (const round of ["first", "again"]) {
      await goTo(page, 8, 55);
      await pulses();
      await page.getByTestId("sandbox-play").click();
      await expect
        .poll(async () => (await page.getByTestId("sandbox-time").textContent()) ?? "", {
          message: round,
        })
        .toMatch(/^(09|1\d|2\d):/);
      await page.getByTestId("sandbox-play").click();
      expect(await pulses()).toContain("automation.away_lamp_off");
    }
  });

  test("in French, from the menu of an administrator only", async ({ page }) => {
    await openHarness(page, { ...OPTIONS, admin: false });
    await expect(page.getByTestId("more")).toHaveCount(0);
    await openHarness(page, { ...OPTIONS, lang: "fr" });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("sandbox-menu")).toContainText(
      "Bac à sable : jouer une journée de vos automatisations",
    );
    await page.getByTestId("sandbox-menu").click();
    await expect(page.getByTestId("sandbox-bar")).toContainText("Rien ici n’atteint un appareil.");
    await page.getByTestId("sandbox-report").click();
    await expect(page.getByTestId("sandbox-report-sheet")).toContainText("Qui se contredisent");
    // The demo house, the measure and the configuration history (D-062, the home's own) wait
    // until the sandbox is left.
    await page.getByTestId("more").click();
    await expect(page.getByTestId("demo-menu")).toHaveCount(0);
    await expect(page.getByTestId("measure")).toBeDisabled();
    await expect(page.getByTestId("config-history")).toBeDisabled();
    await page.getByTestId("sandbox-leave-menu").click();
    await expect(page.getByTestId("sandbox-bar")).toHaveCount(0);
  });
});
