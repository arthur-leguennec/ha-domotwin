#!/usr/bin/env node
// Smoke test against a real, freshly started Home Assistant (nightly job): onboard a throw-away
// owner, add the DomoTwin integration through its config flow, check that the frontend is served,
// and drive the websocket API with the fictional demo plan.
//   HA_URL=<url of a fresh instance> node scripts/ha-smoke.mjs
// Node.js ≥ 22 (global fetch and WebSocket). The password is random and never printed.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = process.env.HA_URL;
if (!base) {
  console.error("Set HA_URL to the address of a fresh Home Assistant instance.");
  process.exit(2);
}
const clientId = `${base}/`;
const demo = JSON.parse(await readFile(new URL("../examples/demo-apartment.plan.json", import.meta.url), "utf8"));

function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  console.log(`ok - ${message}`);
}

async function json(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitForHomeAssistant() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/onboarding", base));
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Home Assistant did not start");
}

async function onboard() {
  const { auth_code: code } = await json("/api/onboarding/users", {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      name: "CI",
      username: "ci",
      password: randomBytes(24).toString("hex"),
      language: "en",
    }),
  });
  const response = await fetch(new URL("/auth/token", base), {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId }),
  });
  if (!response.ok) throw new Error(`token: ${response.status}`);
  return (await response.json()).access_token;
}

function connect(token) {
  const url = new URL("/api/websocket", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (message.type === "auth_ok") resolve();
      else if (message.type === "auth_invalid") reject(new Error("websocket auth refused"));
      else if (message.type === "result") {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    socket.addEventListener("error", () => reject(new Error("websocket error")));
  });
  const send = (message) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ ...message, id }));
    });
  return { ready, send, close: () => socket.close() };
}

await waitForHomeAssistant();
const token = await onboard();
const auth = { authorization: `Bearer ${token}` };

const flow = await json("/api/config/config_entries/flow", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ handler: "domotwin", show_advanced_options: false }),
});
const created = await json(`/api/config/config_entries/flow/${flow.flow_id}`, {
  method: "POST",
  headers: auth,
  body: "{}",
});
check(created.type === "create_entry", "the config flow creates the DomoTwin entry");

const module = await fetch(new URL("/domotwin_static/domotwin.js", base));
check(module.ok, "the frontend module is served");
const build = await (await fetch(new URL("/domotwin_static/build.json", base))).json();
const wasm = await fetch(new URL(`/domotwin_static/${build.wasm}`, base));
check(wasm.ok && wasm.headers.get("content-type")?.includes("wasm"), "the engine is served as wasm");

const ws = connect(token);
await ws.ready;
const panels = await ws.send({ type: "get_panels" });
check(panels.result?.domotwin?.component_name === "custom", "the sidebar panel is registered");
const info = await ws.send({ type: "domotwin/info" });
check(info.success && info.result.has_plan === false, "domotwin/info answers on a fresh install");
const saved = await ws.send({ type: "domotwin/plan/save", plan: demo });
check(saved.success && saved.result.revision === 1, "an administrator saves the demo plan");
const read = await ws.send({ type: "domotwin/plan/get" });
check(read.result.plan.title === demo.title, "the plan reads back");
const bad = await ws.send({ type: "domotwin/plan/save", plan: { ...demo, unit: "mm" } });
check(!bad.success && bad.error.code === "invalid_plan", "an invalid plan is refused");
ws.close();
console.log("Home Assistant smoke test passed.");
