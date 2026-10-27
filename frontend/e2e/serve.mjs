// Static server for the E2E tests: the built frontend under /domotwin_static/ (as the integration
// serves it), the harness page, the fictional examples and the import's fictional test files.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../..");
const port = Number(process.env.PORT ?? 4173);
const routes = [
  ["/domotwin_static/", join(root, "custom_components/domotwin/frontend")],
  ["/examples/", join(root, "examples")],
  ["/fixtures/", join(root, "crates/domotwin-import/tests/fixtures")],
  ["/", here],
];
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
};

// The guests' page (D-067), with the policy the integration sends (`http.py`, `GUEST_CSP`); what
// it asks through the pass is answered by each test (`page.route`).
const GUEST_PAGE = /^\/api\/domotwin\/guest\/[A-Za-z0-9_-]{40,100}\/?$/;
const GUEST_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  if (path === "/health") return response.end("ok");
  if (GUEST_PAGE.test(path)) {
    const page = await readFile(join(root, "custom_components/domotwin/frontend/guest.html"));
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": GUEST_CSP,
      "cache-control": "no-store",
    });
    response.end(page);
    return;
  }
  const [prefix, dir] = routes.find(([prefix]) => path.startsWith(prefix));
  // Resolve inside the route's directory and refuse anything that escapes it.
  const file = resolve(dir, path === "/" ? "harness.html" : `.${sep}${path.slice(prefix.length)}`);
  if (!file.startsWith(dir + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`E2E server on http://127.0.0.1:${port}`));
