/**
 * The focus of DomoTwin's dialogs: it goes into a dialog when it opens (to the element marked
 * `data-autofocus`, else the dialog itself), Escape presses the dialog's `data-cancel` button, and
 * the focus goes back to what had it once the dialog is gone.
 */

/** A key pressed in a field, which may hold what is being typed. */
export function fromField(event: Event): boolean {
  const origin = event.composedPath()[0];
  return origin instanceof HTMLElement && origin.matches("input, textarea, select");
}

/**
 * Whether the field Escape is pressed in keeps it: while an input method composes text (Safari
 * says so only by the key code 229), in a search that holds some (Escape empties it), or in a
 * text written over several lines, not to be lost to a key. From any other field, Escape closes.
 */
export function fieldKeepsEscape(event: KeyboardEvent): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari's only sign of composing.
  if (event.isComposing || event.keyCode === 229) return true;
  const origin = event.composedPath()[0];
  if (origin instanceof HTMLTextAreaElement) return origin.value.trim() !== "";
  return origin instanceof HTMLInputElement && origin.type === "search" && origin.value !== "";
}

/** The element that has the focus, through the shadow roots. */
export function deepActive(): HTMLElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/** The dialog in `host`: itself, or the one its shadow root draws. */
function dialogIn(host: Element): HTMLElement | null {
  if (host.matches('[role="dialog"], [role="alertdialog"]')) return host as HTMLElement;
  return (
    host.shadowRoot?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null
  );
}

/** Moves the focus into the dialog drawn by `host`, once it is drawn. */
export async function focusDialog(host: Element): Promise<void> {
  const pending = (host as Element & { updateComplete?: Promise<unknown> }).updateComplete;
  if (pending) await pending;
  const dialog = dialogIn(host);
  if (!dialog) return;
  const first = dialog.querySelector<HTMLElement>("[data-autofocus]");
  if (first) first.focus({ preventScroll: true });
  else {
    if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
    dialog.focus({ preventScroll: true });
  }
}

/** Escape in the dialog drawn by `host`: its cancel button is pressed. Whether there was one. */
export function cancelDialog(host: Element): boolean {
  const cancel = dialogIn(host)?.querySelector<HTMLElement>("[data-cancel]");
  if (!cancel || cancel.hasAttribute("disabled")) return false;
  cancel.click();
  return true;
}

/**
 * Follows the dialog shown by an element: call `update` after each render with the dialog shown
 * (or `undefined`); the focus goes in and comes back.
 */
export class DialogFocus {
  private shown: Element | undefined;
  private opener: HTMLElement | null = null;

  update(dialog: Element | undefined): void {
    if (dialog === this.shown) return;
    if (dialog && !this.shown) this.opener = deepActive();
    const was = this.shown;
    this.shown = dialog;
    if (dialog) {
      void focusDialog(dialog);
      return;
    }
    // Back to what had the focus, unless the user moved it (a press elsewhere).
    const active = deepActive();
    const lost = active === null || active === document.body || (was?.contains(active) ?? false);
    if (lost && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  /**
   * Escape: the dialog shown is cancelled. Whether it was. Not while an input method composes,
   * nor from a search that holds text (Escape empties it first).
   */
  escape(event: KeyboardEvent): boolean {
    if (fieldKeepsEscape(event)) return false;
    return this.shown ? cancelDialog(this.shown) : false;
  }
}
