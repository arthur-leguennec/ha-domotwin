import { expect, type Page } from "@playwright/test";

export interface HarnessOptions {
  mode?: "card" | "panel";
  lang?: "en" | "fr";
  plan?: "demo" | "none";
  admin?: boolean;
  dark?: boolean;
}

/** Opens the mocked Home Assistant with the built frontend. */
export async function openHarness(page: Page, options: HarnessOptions = {}): Promise<void> {
  const params = new URLSearchParams({
    mode: options.mode ?? "card",
    lang: options.lang ?? "en",
    plan: options.plan ?? "demo",
    admin: options.admin === false ? "0" : "1",
    dark: options.dark ? "1" : "0",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?${params.toString()}`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { __element?: unknown }).__element !== undefined),
    )
    .toBe(true);
  expect(errors).toEqual([]);
}

/** The engine state reported by `<domotwin-view>`. */
export function viewState(
  page: Page,
): Promise<{ engine: string; frames: number; quality?: string }> {
  return page.evaluate(() => {
    const view = (window as never as { __view: () => { debugState(): never } | null }).__view();
    if (!view) throw new Error("no view");
    return view.debugState();
  });
}
