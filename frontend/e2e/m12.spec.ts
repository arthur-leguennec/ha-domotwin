import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

type Call = { type: string; detail?: unknown; pipeline_id?: string };

async function calls(page: Page, type: string): Promise<Call[]> {
  return page.evaluate(
    (wanted) =>
      (window as never as { __calls: Call[] }).__calls.filter((call) => call.type === wanted),
    type,
  );
}

test.describe("voice at hand (D-041)", () => {
  test("the microphone opens Assist, already listening", async ({ page }) => {
    await openHarness(page, { voice: true });
    await page.getByTestId("voice").click();
    await expect.poll(() => calls(page, "hass-action")).toHaveLength(1);
    const [action] = await calls(page, "hass-action");
    expect(action?.detail).toEqual({
      config: { tap_action: { action: "assist", pipeline_id: "whisper", start_listening: true } },
      action: "tap",
    });
  });

  test("no microphone without Assist, or when the card turns it off", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByTestId("overview")).toBeVisible();
    await expect(page.getByTestId("voice")).toHaveCount(0);
    await openHarness(page, { voice: true, mic: false });
    await expect(page.getByTestId("overview")).toBeVisible();
    await expect(page.getByTestId("voice")).toHaveCount(0);
  });

  test("over HTTP, it says why and offers typing instead", async ({ page }) => {
    await openHarness(page, { voice: true, insecure: true });
    await page.getByTestId("voice").click();
    const dialog = page.getByTestId("voice-dialog");
    await expect(dialog).toHaveAttribute("data-mode", "https");
    await expect(dialog).toContainText("The microphone needs HTTPS");
    await page.getByTestId("voice-type").click();
    await expect(dialog).toHaveCount(0);
    const [action] = await calls(page, "hass-action");
    expect(action?.detail).toMatchObject({
      config: { tap_action: { action: "assist", start_listening: false } },
    });
  });

  test("Assist that cannot hear: administrators set up local voice", async ({ page }) => {
    await openHarness(page, { voice: "deaf", supervisor: true });
    await page.getByTestId("voice").click();
    const dialog = page.getByTestId("voice-dialog");
    await expect(dialog).toHaveAttribute("data-mode", "setup");
    await expect(page.getByTestId("voice-consent")).toContainText("nothing you say leaves it");
    await dialog.getByLabel("Speech-to-Phrase").check();
    await page.getByTestId("voice-setup").click();
    await expect(page.getByTestId("voice-progress")).toBeVisible();
    await expect(page.getByTestId("voice-ready")).toContainText("Voice is set up", {
      timeout: 30_000,
    });
    const setups = await calls(page, "domotwin/voice/setup");
    expect(setups).toEqual([{ type: "domotwin/voice/setup", stt: "speech-to-phrase" }]);
    // The microphone listens with it now.
    await dialog.getByTestId("voice-ready").waitFor();
    await dialog.locator("[data-cancel]").click();
    await page.getByTestId("voice").click();
    await expect.poll(() => calls(page, "hass-action")).toHaveLength(1);
    const [action] = await calls(page, "hass-action");
    expect(action?.detail).toMatchObject({
      config: { tap_action: { pipeline_id: "domotwin-local", start_listening: true } },
    });
  });

  test("without apps, the steps; without being an administrator, who to ask", async ({ page }) => {
    await openHarness(page, { voice: "deaf" });
    await page.getByTestId("voice").click();
    await expect(page.getByTestId("voice-steps")).toContainText("rhasspy/wyoming-whisper");
    await openHarness(page, { voice: "deaf", admin: false, lang: "fr" });
    await page.getByTestId("voice").click();
    await expect(page.getByTestId("voice-ask-admin")).toContainText("Demandez à un administrateur");
  });

  test("the panel adds the voice blueprints to Home Assistant", async ({ page }) => {
    await openHarness(page, { mode: "panel", voice: true, blueprints: "changed" });
    await fromMenu(page, "voice-settings");
    const dialog = page.getByTestId("voice-dialog");
    await expect(page.getByTestId("voice-ready")).toBeVisible();
    const status = (name: string) =>
      dialog.locator(`[data-blueprint="${name}"]`).getByTestId("blueprint-status");
    await expect(status("show_by_voice")).toHaveText("Not in Home Assistant yet");
    await expect(status("where_by_voice")).toHaveText("Edited, or from an older DomoTwin");
    await page.getByTestId("blueprints-add").click();
    await expect(status("show_by_voice")).toHaveText("Added");
    // The edited one is kept until it is replaced.
    await expect(status("where_by_voice")).toHaveText("Edited, or from an older DomoTwin");
    await page.getByTestId("blueprints-replace").click();
    await expect(status("where_by_voice")).toHaveText("Added");
    await expect(page.getByTestId("blueprints-use")).toBeVisible();
  });
});

test.describe("the bundled font (D-042)", () => {
  test("served by the integration, used unless the card names another", async ({ page }) => {
    const fonts: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".woff2")) fonts.push(new URL(request.url()).pathname);
    });
    await openHarness(page);
    const tools = page.getByTestId("overview");
    await expect(tools).toBeVisible();
    // The buttons too, which browsers give their own font.
    await expect(tools).toHaveCSS("font-family", /^"DomoTwin Inter"/);
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts]
            .filter((face) => face.family.replace(/"/g, "") === "DomoTwin Inter")
            .map((face) => face.status),
        ),
      )
      .toEqual(["loaded"]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatch(/^\/domotwin_static\/fonts\/inter-variable\.[0-9a-f]{12}\.woff2$/);

    await openHarness(page, { font: "Georgia" });
    await expect(page.getByTestId("overview")).toHaveCSS(
      "font-family",
      /^Georgia, "DomoTwin Inter"/,
    );
    await openHarness(page, { font: "theme" });
    await expect(page.getByTestId("overview")).not.toHaveCSS("font-family", /^"DomoTwin Inter"/);
  });
});

test.describe("the panel's menu", () => {
  test("the export and the settings, from the keyboard too", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await expect(page.locator("domotwin-panel h1")).toHaveText("DomoTwin");
    const more = page.getByTestId("more");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("export")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("settings")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByTestId("demo-menu")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("export")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("more-menu")).toHaveCount(0);
    await expect(more).toBeFocused();
    // A press elsewhere closes it too.
    await more.click();
    await expect(page.getByTestId("more-menu")).toBeVisible();
    await page.mouse.click(400, 400);
    await expect(page.getByTestId("more-menu")).toHaveCount(0);
    await fromMenu(page, "settings");
    await expect(page.getByTestId("settings-dialog")).toBeVisible();
  });
});

test.describe("from the keyboard", () => {
  test("the rooms, their values and their controls", async ({ page }) => {
    await openHarness(page, { live: true });
    const view = page.locator("domotwin-view");
    const stage = view.locator(".stage");
    await expect(stage).toHaveAttribute("role", "application");
    await expect(stage).toHaveAccessibleDescription(/arrows turn/);
    const list = view.getByTestId("room-list");
    // Out of sight until the keyboard reaches it.
    expect((await list.boundingBox())?.width).toBeLessThanOrEqual(1);

    // The layer menu: it takes the focus, the arrows move in it, a choice gives it back.
    const layers = view.getByTestId("layers");
    await layers.focus();
    await page.keyboard.press("Enter");
    const menu = view.getByTestId("layer-menu");
    await expect(menu.locator('[data-layer="off"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-layer="temperature"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(layers).toBeFocused();
    await expect(page.getByTestId("legend")).toContainText("Temperature");

    // The rooms, with the layer's values, open their controls.
    await stage.focus();
    await page.keyboard.press("Tab");
    const first = list.locator("button").first();
    await expect(first).toBeFocused();
    expect((await list.boundingBox())?.width).toBeGreaterThan(100);
    await expect(list.locator('[data-room="hall"]')).toContainText("19.6 °C");
    await list.locator('[data-room="hall"]').focus();
    await page.keyboard.press("Enter");
    await expect(view.locator('.sheet[role="dialog"]')).toHaveAttribute("aria-label", "Hall");
  });
});

test.describe("dialogs", () => {
  test("take the focus, close with Escape and give the focus back", async ({ page }) => {
    await openHarness(page, { mode: "panel" });
    await fromMenu(page, "settings");
    const settings = page.getByTestId("settings-dialog");
    await expect(settings).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await expect(page.getByTestId("more")).toBeFocused();

    await fromMenu(page, "privacy-settings");
    await expect(page.getByTestId("private-rooms-dialog")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("private-rooms-dialog")).toHaveCount(0);
    await expect(page.getByTestId("more")).toBeFocused();

    // A room's sheet, opened from the keyboard.
    const view = page.locator("domotwin-view");
    await view.locator(".stage").focus();
    await page.keyboard.press("Tab");
    const hall = view.getByTestId("room-list").locator('[data-room="hall"]');
    await hall.focus();
    await page.keyboard.press("Enter");
    const sheet = view.locator('.sheet[role="dialog"]');
    await expect(sheet).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(hall).toBeFocused();
  });
});
