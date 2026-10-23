// Static server for the E2E tests: the built frontend under /domotwin_static/ (as the integration
// serves it), the harness page, and the fictional examples.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../..");
const port = Number(process.env.PORT ?? 4173);
const routes = [
  ["/domotwin_static/", join(root, "custom_components/domotwin/frontend")],
  ["/examples/", join(root, "examples")],
  ["/", here],
];
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  if (path === "/health") return response.end("ok");
  const [prefix, dir] = routes.find(([prefix]) => path.startsWith(prefix));
  const file = normalize(join(dir, path === "/" ? "harness.html" : path.slice(prefix.length)));
  if (!file.startsWith(dir + sep) && file !== dir) {
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
