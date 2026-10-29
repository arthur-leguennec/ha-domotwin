import { afterEach, describe, expect, it, vi } from "vitest";

import { DialogFocus, cancelDialog } from "../src/components/dialog";
import { focusBack, focusMenu, menuKeydown } from "../src/components/menu";

function menu(): { menu: HTMLElement; items: HTMLButtonElement[]; opener: HTMLButtonElement } {
  const opener = document.createElement("button");
  const element = document.createElement("div");
  element.setAttribute("role", "menu");
  const items = ["a", "b", "c"].map((name) => {
    const item = document.createElement("button");
    item.setAttribute("role", "menuitemradio");
    item.textContent = name;
    element.append(item);
    return item;
  });
  items[2]?.setAttribute("disabled", "");
  document.body.append(opener, element);
  return { menu: element, items, opener };
}

function press(target: HTMLElement, key: string, close = vi.fn(), opener?: HTMLElement): void {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  target.addEventListener(
    "keydown",
    (e) => {
      menuKeydown(e, close, opener);
    },
    { once: true },
  );
  target.dispatchEvent(event);
}

describe("menus and dialogs from the keyboard (D-042)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("focus the checked item, move with the arrows past the disabled ones, close with Escape", () => {
    const { menu: m, items, opener } = menu();
    items[1]?.setAttribute("aria-checked", "true");
    focusMenu(m);
    expect(document.activeElement).toBe(items[1]);
    press(m, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press(m, "ArrowUp");
    expect(document.activeElement).toBe(items[1]);
    press(m, "Home");
    expect(document.activeElement).toBe(items[0]);
    const close = vi.fn();
    press(m, "Escape", close, opener);
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("give the focus back only when it was lost", () => {
    const { items, opener } = menu();
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    focusBack(opener);
    expect(document.activeElement).toBe(elsewhere);
    items[0]?.focus();
    items[0]?.remove();
    focusBack(opener);
    expect(document.activeElement).toBe(opener);
  });

  it("a dialog takes the focus, Escape presses its cancel button, the focus comes back", async () => {
    const opener = document.createElement("button");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const cancel = document.createElement("button");
    cancel.setAttribute("data-cancel", "");
    const clicked = vi.fn(() => {
      dialog.remove();
    });
    cancel.addEventListener("click", clicked);
    dialog.append(cancel);
    document.body.append(opener, dialog);
    opener.focus();
    const focus = new DialogFocus();
    focus.update(dialog);
    await Promise.resolve();
    expect(document.activeElement).toBe(dialog);
    // Not while an input method composes, nor from a search that holds text: Escape is theirs.
    const field = document.createElement("input");
    const search = document.createElement("input");
    search.type = "search";
    search.value = "lamp";
    dialog.append(field, search);
    const kept: boolean[] = [];
    for (const target of [field, search]) {
      target.addEventListener("keydown", (event) => {
        kept.push(focus.escape(event));
      });
    }
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", composed: true, isComposing: true }),
    );
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", composed: true }));
    expect(kept).toEqual([false, false]);
    // From any other field, as from a button: the dialog is cancelled.
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", composed: true }));
    expect(kept).toEqual([false, false, true]);
    expect(clicked).toHaveBeenCalledOnce();
    focus.update(undefined);
    expect(document.activeElement).toBe(opener);
    expect(cancelDialog(document.createElement("div"))).toBe(false);
  });
});
