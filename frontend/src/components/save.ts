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
