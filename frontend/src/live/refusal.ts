/**
 * What Home Assistant answered when it refused: its configuration API's message (`{ body }`), or
 * its websocket's (`{ code, message }`). Shared by the dialogs that write Home Assistant's
 * configuration (D-062, D-069).
 */
export function refusal(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || error instanceof Error) return undefined;
  const { body, message } = error as { body?: unknown; message?: unknown };
  if (typeof body === "object" && body !== null) {
    const said = (body as { message?: unknown }).message;
    if (typeof said === "string" && said) return said;
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return typeof message === "string" && message ? message : undefined;
}
