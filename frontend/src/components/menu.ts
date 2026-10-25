/**
 * The keyboard of DomoTwin's menus (the WAI-ARIA menu pattern): the arrows, Home and End move
 * between the items, Escape and Tab close the menu, and focus goes back to the button that opened
 * it.
 */

import { deepActive } from "./dialog";

function items(menu: HTMLElement): HTMLElement[] {
  return [
    ...menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
    ),
  ].filter((item) => !item.hasAttribute("disabled"));
}

function focused(menu: HTMLElement): Element | null {
  return (menu.getRootNode() as Document | ShadowRoot).activeElement;
}

/** Focuses the menu's checked item, else its first, once it is drawn. */
export function focusMenu(menu: HTMLElement | null | undefined): void {
  if (!menu) return;
  const all = items(menu);
  (all.find((item) => item.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
}

/**
 * Handles a key pressed in `menu` (its `keydown`): `close` closes it; `opener`, the button that
 * opened it, gets the focus back on Escape.
 */
export function menuKeydown(
  event: KeyboardEvent,
  close: () => void,
  opener?: HTMLElement | null,
): void {
  const menu = event.currentTarget as HTMLElement;
  const all = items(menu);
  const at = all.indexOf(focused(menu) as HTMLElement);
  const move = (index: number): void => {
    event.preventDefault();
    all[(index + all.length) % all.length]?.focus();
  };
  switch (event.key) {
    case "ArrowDown":
      move(at + 1);
      break;
    case "ArrowUp":
      move(at < 0 ? all.length - 1 : at - 1);
      break;
    case "Home":
      move(0);
      break;
    case "End":
      move(all.length - 1);
      break;
    case "Escape":
      event.preventDefault();
      event.stopPropagation();
      close();
      opener?.focus();
      break;
    case "Tab":
      close();
      break;
  }
}

/**
 * After a menu closed: gives the focus back to `opener` when it was in the menu (an item chosen,
 * gone with the menu), not when the user moved it elsewhere.
 */
export function focusBack(opener: HTMLElement | null | undefined): void {
  const active = deepActive();
  if (active === null || active === document.body) opener?.focus();
}
