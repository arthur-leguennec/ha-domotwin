/**
 * Where the integration serves DomoTwin's files. The entry module records its own URL at startup,
 * so assets resolve next to it whatever chunk asks for them.
 */
let base: URL | undefined;

export function setAssetBase(url: URL): void {
  base = url;
}

export function assetUrl(file: string): URL {
  return new URL(file, base ?? new URL("/domotwin_static/", location.origin));
}
