import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness, settle } from "./fixtures";

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

test.describe("Bluetooth locating (D-035)", () => {
  test("administrators follow devices and place receivers", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, bluetooth: true });
    await settle(page);
    await fromMenu(page, "bluetooth-settings");
    const dialog = page.getByTestId("bluetooth-settings-dialog");
    await expect(dialog.locator("[data-receiver]")).toHaveCount(3);
    await expect(dialog.locator('[data-receiver="AA:00:00:00:00:03"]')).toContainText(
      "In its device's area",
    );
    const phone = dialog.locator('[data-device="alex_phone"]');
    await expect(phone).toContainText("By its key: Alex's iPhone");
    await expect(phone).toContainText("Now in the Kitchen (87 %)");
    // The hall's receiver is placed by hand; a tag heard is followed, nobody's.
    await dialog
      .locator('[data-receiver="CC:00:00:00:00:01"]')
      .getByTestId("receiver-room")
      .selectOption("hall");
    await dialog.getByTestId("bluetooth-find").click();
    await expect(dialog.locator("[data-candidate]")).toHaveCount(3);
    await dialog.locator('[data-candidate="Bag tag"]').getByTestId("bluetooth-follow").click();
    const bag = dialog.locator('[data-device="bag_tag"]');
    await expect(bag.getByTestId("device-kind")).toHaveValue("thing");
    await bag.getByTestId("device-owner").selectOption("person.sam");
    await expect(dialog.locator('[data-candidate="Bag tag"]')).toHaveCount(0);
    await dialog.getByTestId("bluetooth-save").click();
    await expect(dialog).toHaveCount(0);
    const saves = await sent(page, "domotwin/locating/save");
    expect(saves.at(-1)).toEqual({
      type: "domotwin/locating/save",
      receivers: {
        "BB:00:00:00:00:01": { room: "bedroom" },
        "CC:00:00:00:00:01": { room: "hall" },
      },
      devices: {
        alex_phone: {
          name: "Alex's phone",
          kind: "phone",
          person: "person.alex",
          match: { key: "entry-alex-phone" },
        },
        keys: {
          name: "Keys",
          kind: "thing",
          person: "person.alex",
          match: { address: "F1:00:00:00:00:01" },
        },
        bag_tag: {
          name: "Bag tag",
          kind: "thing",
          person: "person.sam",
          match: { address: "F1:22:33:44:55:66" },
        },
      },
      learn: true,
      expected_revision: 1,
    });
  });

  test("a room is taught by holding a device in it", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, bluetooth: true });
    await settle(page);
    await fromMenu(page, "bluetooth-settings");
    const dialog = page.getByTestId("bluetooth-settings-dialog");
    await expect(dialog.getByTestId("learned")).toContainText("Nothing learned yet");
    await dialog.getByTestId("teach-room").selectOption("living");
    await dialog.getByTestId("teach-start").click();
    await expect(dialog.getByTestId("teach-status")).toContainText(
      "Listening: stay in the Living room",
    );
    await expect(dialog.getByTestId("teach-done")).toHaveText(
      "Learned from 14 readings by 3 receivers.",
    );
    await expect(dialog.getByTestId("learned")).toHaveText("Living room");
    expect(await sent(page, "domotwin/locating/teach")).toEqual([
      { type: "domotwin/locating/teach", device: "alex_phone", room: "living", seconds: 30 },
    ]);
    await dialog.getByTestId("bluetooth-forget").click();
    await expect(dialog.getByTestId("learned")).toContainText("Nothing learned yet");
  });

  test("people's sheets list their devices, the room panels the things in them", async ({
    page,
  }) => {
    await openHarness(page, { live: true, people: true, bluetooth: true });
    await settle(page);
    await page.locator('[data-testid="people"] [data-person="person.alex"]').click();
    const devices = page.getByTestId("person").getByTestId("person-devices");
    await expect(devices.locator("li")).toHaveText([
      "Keys left behind, in the Kitchen",
      "Alex's phone: in the Kitchen",
    ]);
    await page.getByTestId("person").getByTestId("person-room").click();
    const things = page.getByTestId("room").getByTestId("room-things");
    await expect(things).toContainText("Alex's phone");
    await expect(things).toContainText("Keys");
  });

  test("the people's settings say who Bluetooth places", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, bluetooth: true });
    await settle(page);
    await fromMenu(page, "people-settings");
    await expect(
      page
        .getByTestId("people-settings-dialog")
        .locator('[data-person="person.alex"]')
        .getByTestId("person-bluetooth"),
    ).toHaveText("Followed by Bluetooth: Alex's phone");
  });

  test("without Bluetooth, the dialog says how to get it", async ({ page }) => {
    await openHarness(page, { mode: "panel", live: true, people: true, bluetooth: "none" });
    await settle(page);
    await fromMenu(page, "bluetooth-settings");
    const dialog = page.getByTestId("bluetooth-settings-dialog");
    await expect(dialog.getByTestId("bluetooth-status")).toContainText(
      "Home Assistant has no Bluetooth",
    );
    await expect(dialog.getByTestId("teach-start")).toHaveCount(0);
    // No identity key to hand either: Private BLE Device listens through that Bluetooth (D-074).
    await expect(dialog.getByTestId("iphone-key")).toHaveCount(0);
  });
});
