/** What the browser keeps for the user: a file it downloads, text on the clipboard. */

/** Saves `text` as a file named `name` (the browser's download). */
export function saveText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Puts `text` on the clipboard; whether it could (some companion apps refuse it). */
export async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Puts `text` on the clipboard; where it is refused, `shown("manual")` has `host` show it in a
 * `textarea` (the first matching `selector`), which is then selected to copy by hand.
 */
export async function copyText(
  text: string,
  host: { renderRoot: ParentNode; updateComplete: Promise<unknown> },
  shown: (copied: "done" | "manual") => void,
  selector = "textarea",
): Promise<void> {
  if (await toClipboard(text)) {
    shown("done");
    return;
  }
  shown("manual");
  await host.updateComplete;
  const area = host.renderRoot.querySelector<HTMLTextAreaElement>(selector);
  area?.focus();
  area?.select();
}
