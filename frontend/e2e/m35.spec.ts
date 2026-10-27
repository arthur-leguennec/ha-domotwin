import { expect, test, type Page } from "@playwright/test";

import { fromMenu, openHarness } from "./fixtures";

interface Call {
  type: string;
  domain?: string;
  service?: string;
  method?: string;
  path?: string;
  parameters?: Record<string, unknown>;
  service_data?: { instructions?: string; entity_id?: string };
}

/** What was asked of the visitor's own (mocked) Home Assistant. */
function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => (window as never as { __calls: Call[] }).__calls);
}

/** What was asked of the AI task. */
async function asked(page: Page): Promise<Call[]> {
  return (await calls(page)).filter((c) => c.type === "call_service" && c.domain === "ai_task");
}

const OPTIONS = {
  mode: "panel",
  live: true,
  automations: true,
  people: true,
  sandbox: true,
  aiTask: true,
} as const;

const REQUEST = "When the last person leaves, switch the lights off and lock the door.";

/** Writes the request and waits for Home Assistant's check. */
async function write(page: Page, request = REQUEST): Promise<void> {
  await fromMenu(page, "plain-words");
  const dialog = page.getByTestId("plain-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("plain-request").fill(request);
  await page.getByTestId("plain-write").click();
  await expect(page.getByTestId("plain-words")).toBeVisible();
}

/** In the sandbox, everyone goes out at nine. */
async function everyoneOutAtNine(page: Page): Promise<void> {
  await page.getByTestId("sandbox-day").click();
  for (const person of ["person.alex", "person.kim", "person.sam"]) {
    const row = page.locator(`[data-person="${person}"]`);
    await row.getByTestId("sandbox-person-home").check();
    await row.getByTestId("sandbox-person-leaves").fill("09:00");
    await row.getByTestId("sandbox-person-back").fill("");
  }
  await page.getByTestId("sandbox-day-apply").click();
  await expect(page.getByTestId("sandbox-day-sheet")).toHaveCount(0);
}

test.describe("an automation in plain words (D-069)", () => {
  test("is offered only where Home Assistant has an AI task, to administrators", async ({
    page,
  }) => {
    await openHarness(page, { ...OPTIONS, aiTask: false });
    await page.getByTestId("more").click();
    await expect(page.getByTestId("config-history")).toBeVisible();
    await expect(page.getByTestId("plain-words")).toHaveCount(0);
    // Someone who is not an administrator has no such menu: only the export.
    await openHarness(page, { ...OPTIONS, admin: false });
    await expect(page.getByRole("button", { name: "Export plan" })).toBeVisible();
    await expect(page.getByTestId("plain-words")).toHaveCount(0);
  });

  test("writes it with the AI task, says it back, plays it in the sandbox, then saves it", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    await fromMenu(page, "plain-words");
    // What goes to the AI task, said before it is sent.
    await expect(page.getByTestId("plain-sent")).toContainText("go to Fictional assistant");
    await expect(page.getByTestId("plain-sent")).toContainText("never their states");
    await expect(page.getByTestId("plain-write")).toBeDisabled();
    await page.getByTestId("plain-request").fill(REQUEST);
    await page.getByTestId("plain-write").click();
    const [question] = await asked(page);
    expect(question?.service_data?.entity_id).toBe("ai_task.fictional_assistant");
    const instructions = question?.service_data?.instructions ?? "";
    expect(instructions).toContain(REQUEST);
    expect(instructions).toContain("lock.entrance_door: ");
    // Names, never states: Kim is out, the lamps are on, none of it is said.
    expect(instructions).toMatch(/\nperson\.kim: Kim\n/);
    expect(instructions).toMatch(
      /\nlight\.living_room_floor_lamp: Living room floor lamp \[living_room\]\n/,
    );
    // Said back in plain words, from the configuration; the focus on its name.
    await expect(page.getByTestId("plain-name")).toBeFocused();
    await expect(page.getByTestId("plain-name")).toHaveValue(
      "Lights off and door locked when everyone leaves",
    );
    await expect(page.getByTestId("plain-when")).toHaveText("When nobody is left in Home");
    await expect(page.getByTestId("plain-only-if")).toHaveCount(0);
    await expect(page.getByTestId("plain-then").locator("li")).toHaveText([
      "Switch off Living room floor lamp, Sideboard lamp, and Kitchen ceiling",
      "Lock Entrance door",
    ]);
    await expect(page.getByTestId("plain-notes")).toContainText("the home zone counts nobody");
    // Checked with Home Assistant; not saved before it is played.
    await expect(page.getByTestId("plain-check-ok")).toBeVisible();
    expect((await calls(page)).filter((c) => c.type === "validate_config")).toHaveLength(1);
    await expect(page.getByTestId("plain-save")).toBeDisabled();
    await expect(page.getByTestId("plain-save-why")).toContainText("played in the sandbox");
    await expect(page.getByTestId("plain-played")).toContainText("Not played yet");
    // Played in the sandbox, beside the home's automations, its wires on the plan.
    const before = (await calls(page)).length;
    await page.getByTestId("plain-play").click();
    await expect(page.getByTestId("plain-dialog")).toHaveCount(0);
    const strip = page.getByTestId("sandbox-draft");
    await expect(strip).toContainText("Draft: Lights off and door locked when everyone leaves");
    await expect(page.getByTestId("wires")).toBeVisible();
    await everyoneOutAtNine(page);
    await expect(page.getByTestId("sandbox-draft-day")).toContainText("Ran once this day.");
    await page.getByTestId("sandbox-report").click();
    const report = page.getByTestId("sandbox-draft-report");
    await expect(report).toContainText("1 run");
    await expect(report).toContainText("09:00");
    // The lamps were off already by then; the door is locked.
    await expect(report).toContainText("light.turn_off");
    await expect(report).toContainText("lock.lock: Entrance door");
    // Nothing reached the home meanwhile: only reads.
    expect(
      (await calls(page))
        .slice(before)
        .filter((c) => c.type === "call_service" || c.type === "api" || /save$/.test(c.type)),
    ).toEqual([]);
    // Back to the draft: the days played, and now it can be saved.
    await page.getByTestId("sandbox-draft-back").click();
    await expect(page.getByTestId("sandbox-bar")).toHaveCount(0);
    await expect(page.getByTestId("plain-days")).toContainText(": ran once, at 09:00");
    await expect(page.getByTestId("plain-save")).toBeEnabled();
    await page.getByTestId("plain-name").fill("Leaving home");
    await page.getByTestId("plain-name").press("Tab");
    await page.getByTestId("plain-save").click();
    await expect(page.getByTestId("plain-saved")).toContainText("Saved: Leaving home.");
    const saved = (await calls(page)).filter((c) => c.type === "api");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.method).toBe("POST");
    expect(saved[0]?.path).toMatch(/^config\/automation\/config\/\d{13}$/);
    expect(saved[0]?.parameters).toMatchObject({
      alias: "Leaving home",
      description: REQUEST,
      triggers: [{ trigger: "state", entity_id: "zone.home", to: "0" }],
      conditions: [],
      mode: "single",
    });
    const id = saved[0]?.path?.split("/").pop() ?? "";
    await expect(page.getByTestId("plain-open-editor")).toHaveAttribute(
      "href",
      `/config/automation/edit/${id}`,
    );
    await page.getByTestId("plain-another").click();
    await expect(page.getByTestId("plain-request")).toHaveValue("");
  });

  test("is changed by asking, and is checked and played again", async ({ page }) => {
    await openHarness(page, OPTIONS);
    await write(page);
    await page.getByTestId("plain-play").click();
    await page.getByTestId("sandbox-draft-back").click();
    await expect(page.getByTestId("plain-days").locator("li")).toHaveCount(1);
    await page.getByTestId("plain-change").fill("Wait five minutes before locking the door.");
    await page.getByTestId("plain-change-button").click();
    await expect(page.getByTestId("plain-then").locator("li")).toHaveText([
      "Switch off Living room floor lamp, Sideboard lamp, and Kitchen ceiling",
      "Wait 5 minutes",
      "Lock Entrance door",
    ]);
    // The AI task had the request, the draft and the change.
    const [, change] = await asked(page);
    const instructions = change?.service_data?.instructions ?? "";
    expect(instructions).toContain(REQUEST);
    expect(instructions).toContain('"alias":"Lights off and door locked when everyone leaves"');
    expect(instructions).toContain("Wait five minutes before locking the door.");
    // A new draft: played again before it is saved.
    await expect(page.getByTestId("plain-played")).toContainText("Not played yet");
    await expect(page.getByTestId("plain-save")).toBeDisabled();
    await expect(page.getByTestId("plain-whole")).toContainText(
      `"description": "${REQUEST}\\nWait five minutes before locking the door."`,
    );
  });

  test("says what Home Assistant does not have, and what it refuses", async ({ page }) => {
    await openHarness(page, OPTIONS);
    await page.evaluate(() => {
      (window as never as { __aiAnswer: unknown }).__aiAnswer = {
        name: "Porch",
        automation: JSON.stringify({
          triggers: [{ trigger: "sun", event: "sunset" }],
          actions: [{ action: "light.turn_on", target: { entity_id: "light.porch" } }],
        }),
      };
      (window as never as { __invalidConfig: unknown }).__invalidConfig = {
        part: "triggers",
        error: "Invalid value for event",
      };
    });
    await write(page, "Light the porch at sunset");
    await expect(page.getByTestId("plain-when")).toHaveText("At sunset");
    const then = page.getByTestId("plain-then").locator("li");
    await expect(then).toContainText("Switch on light.porch");
    await expect(then).toContainText("not in Home Assistant");
    const problems = page.getByTestId("plain-check-problems");
    await expect(problems).toContainText("Triggers: Invalid value for event");
    await expect(problems).toContainText("Entities Home Assistant does not have: light.porch");
    await expect(page.getByTestId("plain-save")).toBeDisabled();
    await expect(page.getByTestId("plain-save-why")).toContainText("finds nothing wrong");
  });

  test("says when the answer is not an automation, and when the AI task refuses", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    await page.evaluate(() => {
      (window as never as { __aiAnswer: unknown }).__aiAnswer = {
        name: "Nothing",
        automation: "Sorry, I cannot do that.",
      };
    });
    await fromMenu(page, "plain-words");
    await page.getByTestId("plain-request").fill("Make me a coffee");
    await page.getByTestId("plain-write").click();
    const unread = page.getByTestId("plain-unread");
    await expect(unread).toContainText("not an automation DomoTwin can read");
    await unread.getByText("What it answered").click();
    await expect(unread).toContainText("Sorry, I cannot do that.");
    await page.evaluate(() => {
      (window as never as { __aiFail: string }).__aiFail = "The model is not loaded";
    });
    await page.getByTestId("plain-write").click();
    await expect(page.getByTestId("plain-error")).toHaveText(
      "The AI task did not write it: The model is not loaded",
    );
  });

  test("drops an answer cancelled, and shows Home Assistant's refusal to save", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    await page.evaluate(() => {
      const w = window as never as { __aiHold: Promise<void>; __aiRelease: () => void };
      w.__aiHold = new Promise((resolve) => {
        w.__aiRelease = resolve;
      });
    });
    await fromMenu(page, "plain-words");
    await page.getByTestId("plain-request").fill(REQUEST);
    await page.getByTestId("plain-write").click();
    await expect(page.getByTestId("plain-writing")).toContainText("Fictional assistant is writing");
    await page.getByTestId("plain-cancel").click();
    await page.evaluate(() => {
      (window as never as { __aiRelease: () => void }).__aiRelease();
    });
    await expect(page.getByTestId("plain-writing")).toHaveCount(0);
    await expect(page.getByTestId("plain-words")).toHaveCount(0);
    await expect(page.getByTestId("plain-write")).toBeEnabled();
    // Written, played, then refused by Home Assistant.
    await page.getByTestId("plain-write").click();
    await expect(page.getByTestId("plain-check-ok")).toBeVisible();
    await page.getByTestId("plain-play").click();
    await page.getByTestId("sandbox-draft-back").click();
    await page.evaluate(() => {
      (window as never as { __refuseConfig: string }).__refuseConfig =
        "Message malformed: Entity lock.entrance_door is not valid";
    });
    await page.getByTestId("plain-save").click();
    await expect(page.getByTestId("plain-error")).toHaveText(
      "Home Assistant did not save it: Message malformed: Entity lock.entrance_door is not valid",
    );
    await expect(page.getByTestId("plain-saved")).toHaveCount(0);
  });

  test("keeps the draft when the dialog is closed and when the sandbox is left", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    await write(page);
    await page.getByTestId("plain-dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("plain-dialog")).toHaveCount(0);
    await fromMenu(page, "plain-words");
    await expect(page.getByTestId("plain-when")).toHaveText("When nobody is left in Home");
    await page.getByTestId("plain-play").click();
    // Not offered in the sandbox, which is a copy of the home.
    await page.getByTestId("more").click();
    await expect(page.getByTestId("plain-words")).toHaveCount(0);
    await page.getByTestId("sandbox-leave-menu").click();
    await expect(page.getByTestId("sandbox-bar")).toHaveCount(0);
    await fromMenu(page, "plain-words");
    await expect(page.getByTestId("plain-days").locator("li")).toHaveCount(1);
    await page.getByTestId("plain-start-over").click();
    await expect(page.getByTestId("plain-request")).toHaveValue("");
  });

  test("names nothing to the AI task before the private rooms are read, nor what they hold", async ({
    page,
  }) => {
    await openHarness(page, { ...OPTIONS, private: ["living"], settingsDown: true });
    await page.evaluate(() => {
      (window as never as { __settingsUp: () => void }).__settingsUp();
    });
    await fromMenu(page, "plain-words");
    await expect(page.getByTestId("plain-sent")).toBeVisible();
    await page.getByTestId("plain-request").fill(REQUEST);
    await page.getByTestId("plain-write").click();
    await expect(page.getByTestId("plain-words")).toBeVisible();
    const instructions = (await asked(page))[0]?.service_data?.instructions ?? "";
    expect(instructions).toContain("light.kitchen_ceiling: ");
    expect(instructions).not.toContain("light.living_room_floor_lamp");
    expect(instructions).not.toContain("living_room: Living room");
  });

  test("waits for the home to be read before anything goes to the AI task", async ({ page }) => {
    await openHarness(page, { ...OPTIONS, settingsDown: true });
    // The menu waits for the settings too: opened from the panel's code.
    await page.evaluate(async () => {
      const panel = (window as never as { __element: { openPlain: () => Promise<void> } })
        .__element;
      await panel.openPlain();
    });
    await expect(page.getByTestId("plain-reading")).toBeVisible();
    await page.getByTestId("plain-request").fill(REQUEST);
    await expect(page.getByTestId("plain-write")).toBeDisabled();
    await page.evaluate(() => {
      (window as never as { __settingsUp: () => void }).__settingsUp();
    });
    await expect(page.getByTestId("plain-sent")).toBeVisible();
    await expect(page.getByTestId("plain-write")).toBeEnabled();
    expect(await asked(page)).toEqual([]);
  });

  test("checks again, says what it leaves out, and saves once though closed meanwhile", async ({
    page,
  }) => {
    await openHarness(page, OPTIONS);
    await page.evaluate(() => {
      const w = window as never as { __aiAnswer: unknown; __invalidConfig: unknown };
      w.__aiAnswer = {
        name: "Leaving",
        automation: JSON.stringify({
          triggers: [{ trigger: "state", entity_id: "zone.home", to: "0" }],
          actions: [{ action: "lock.lock", target: { entity_id: "lock.entrance_door" } }],
          initial_state: false,
        }),
      };
      w.__invalidConfig = { part: "actions", error: "Home Assistant is starting" };
    });
    await write(page);
    await expect(page.getByTestId("plain-dropped")).toContainText("initial_state");
    await expect(page.getByTestId("plain-check-problems")).toContainText("is starting");
    await page.evaluate(() => {
      (window as never as { __invalidConfig: unknown }).__invalidConfig = undefined;
    });
    await page.getByTestId("plain-check-again").click();
    await expect(page.getByTestId("plain-check-ok")).toBeVisible();
    await page.getByTestId("plain-play").click();
    await page.getByTestId("sandbox-draft-back").click();
    // Home Assistant slow to save: the dialog closed and opened again meanwhile.
    await page.evaluate(() => {
      const w = window as never as { __apiHold: Promise<void>; __apiRelease: () => void };
      w.__apiHold = new Promise((resolve) => {
        w.__apiRelease = resolve;
      });
    });
    await page.getByTestId("plain-save").click();
    await expect(page.getByTestId("plain-save")).toHaveText("Saving…");
    await page.getByTestId("plain-dialog").getByRole("button", { name: "Close" }).click();
    await fromMenu(page, "plain-words");
    await expect(page.getByTestId("plain-save")).toBeDisabled();
    await page.evaluate(() => {
      (window as never as { __apiRelease: () => void }).__apiRelease();
    });
    await expect(page.getByTestId("plain-saved")).toContainText("Saved: Leaving.");
    const saved = (await calls(page)).filter((c) => c.type === "api");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.parameters).not.toHaveProperty("initial_state");
    await expect(page.getByTestId("plain-another")).toBeFocused();
  });

  test("speaks French", async ({ page }) => {
    await openHarness(page, { ...OPTIONS, lang: "fr" });
    await fromMenu(page, "plain-words");
    await expect(page.getByTestId("plain-dialog")).toContainText(
      "Une automatisation dite avec vos mots",
    );
    await page
      .getByTestId("plain-request")
      .fill("Quand la dernière personne part, éteindre les lumières et verrouiller la porte.");
    await page.getByTestId("plain-write").click();
    await expect(page.getByTestId("plain-name")).toHaveValue("Tout éteindre en partant");
    await expect(page.getByTestId("plain-when")).toHaveText(
      "Quand il ne reste plus personne dans Home",
    );
    await expect(page.getByTestId("plain-then").locator("li")).toHaveText([
      "Éteindre Living room floor lamp, Sideboard lamp et Kitchen ceiling",
      "Verrouiller Entrance door",
    ]);
    await expect(page.getByTestId("plain-check-ok")).toContainText(
      "Home Assistant n’y trouve rien à redire",
    );
    await page.getByTestId("plain-play").click();
    await expect(page.getByTestId("sandbox-draft")).toContainText("Brouillon : Tout éteindre");
    await page.getByTestId("sandbox-draft-back").click();
    await expect(page.getByTestId("plain-played")).toContainText("Jouée dans le bac à sable");
  });
});
