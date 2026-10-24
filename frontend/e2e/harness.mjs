// A mocked Home Assistant around the real built frontend. Query parameters:
//   mode=card|panel  lang=en|fr  plan=demo|none  admin=1|0  dark=1  view=3d|2d  cutaway=auto|always|off
//   lighting=auto|morning|day|evening|night  sun=<elevation>,<rising 0|1> (a sun.sun entity)
//   live=1 (the demo bindings, and the demo home's entities, areas and states)
//   models=1 (the demo plan with a bar stool drawn from examples/models/stool.glb, twice)
import { applyService, demoHome } from "./demo-home.mjs";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "card";
const live = params.get("live") === "1";

await import("/domotwin_static/domotwin.js?v=e2e");

const demo = await (await fetch("/examples/demo-apartment.plan.json")).json();
const demoBindings = live
  ? await (await fetch("/examples/demo-apartment.bindings.json")).json()
  : { version: 1, rooms: {}, elements: {} };
const store = {
  plan: params.get("plan") === "none" ? null : demo,
  layout: {},
  bindings: demoBindings,
  revision: 1,
  /** Model files kept by the mocked integration, by `<sha256>.<format>`. */
  files: new Map(),
};
window.__store = store;

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

if (params.get("models") === "1" && store.plan) {
  const bytes = new Uint8Array(await (await fetch("/examples/models/stool.glb")).arrayBuffer());
  const hash = await sha256(bytes);
  store.files.set(`${hash}.glb`, bytes);
  store.plan.models = {
    "m-stool": {
      name: "Bar stool",
      size: [38, 38, 71],
      file: { format: "glb", hash, bytes: bytes.length, up: "y" },
    },
  };
  for (const [id, x] of [
    ["stool-1", 80],
    ["stool-2", 130],
  ]) {
    store.plan.elements.push({
      id,
      type: "furniture",
      name: "Bar stool",
      x,
      y: 280,
      w: 38,
      h: 38,
      z: 71,
      kind: "custom",
      model: "m-stool",
      parent: "living",
    });
  }
}

/** The integration's model file views (`/api/domotwin/models`), with the user's session. */
async function fetchWithAuth(path, init = {}) {
  calls.push({ type: "fetch", method: init.method ?? "GET", path });
  const url = new URL(path, location.origin);
  if (url.pathname === "/api/domotwin/models" && init.method === "POST") {
    if (!hass.user.is_admin) return Response.json({ code: "unauthorized" }, { status: 403 });
    const format = url.searchParams.get("format");
    const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    const hash = await sha256(bytes);
    store.files.set(`${hash}.${format}`, bytes);
    return Response.json({ hash, bytes: bytes.length, format });
  }
  const name = url.pathname.replace("/api/domotwin/models/", "");
  const bytes = store.files.get(name);
  if (!bytes || window.__failModelFiles)
    return Response.json({ code: "not_found" }, { status: 404 });
  return new Response(bytes);
}
const listeners = new Set();
const calls = [];
window.__calls = calls;

const connection = {
  async sendMessagePromise(message) {
    calls.push(message);
    switch (message.type) {
      case "domotwin/plan/get":
        return structuredClone({
          plan: store.plan,
          layout: store.layout,
          revision: store.revision,
        });
      case "domotwin/bindings/get":
        return structuredClone({ bindings: store.bindings, revision: store.revision });
      case "domotwin/plan/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        if ("plan" in message) store.plan = message.plan;
        if ("layout" in message) store.layout = message.layout;
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "plan", revision: store.revision });
        return { revision: store.revision };
      }
      case "domotwin/bindings/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        store.bindings = message.bindings;
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "bindings", revision: store.revision });
        return { revision: store.revision };
      }
      default:
        throw { code: "unknown_command", message: message.type };
    }
  },
  async subscribeMessage(callback, message) {
    calls.push(message);
    listeners.add(callback);
    return async () => listeners.delete(callback);
  },
};

const language = params.get("lang") ?? "en";
const sunParam = params.get("sun");
const home = live ? demoHome() : { states: {}, entities: {}, devices: {}, areas: {} };
const states = home.states;
if (sunParam) {
  const [elevation, rising] = sunParam.split(",");
  states["sun.sun"] = {
    entity_id: "sun.sun",
    state: Number(elevation) > 0 ? "above_horizon" : "below_horizon",
    attributes: { elevation: Number(elevation), rising: rising === "1" },
  };
}
let hass = {
  states,
  entities: home.entities,
  devices: home.devices,
  areas: home.areas,
  user: { id: "e2e", name: "E2E", is_admin: params.get("admin") !== "0" },
  language,
  locale: { language },
  themes: { darkMode: params.get("dark") === "1" },
  connection,
  fetchWithAuth,
  async callService(domain, service, data, target) {
    calls.push({ type: "call_service", domain, service, data, target });
    if (window.__failServices)
      throw { code: "service_failed", message: "The device did not answer" };
    const [realDomain, realService] =
      domain === "homeassistant"
        ? [String(target?.entity_id).split(".")[0], service]
        : [domain, service];
    if (applyService(home, realDomain, realService, data, target).length > 0) publish();
  },
};
window.__hass = hass;

/** Home Assistant gives a new `hass` object, with new state objects for what changed. */
function publish() {
  hass = { ...hass, states: { ...home.states } };
  window.__hass = hass;
  if (element) element.hass = hass;
}

/** Changes an entity as if a device did (E2E tests). */
window.__setState = (entityId, state, attributes = {}) => {
  const previous = home.states[entityId];
  home.states[entityId] = {
    entity_id: entityId,
    state,
    attributes: { ...(previous?.attributes ?? {}), ...attributes },
  };
  publish();
};
if (hass.themes.darkMode) document.body.classList.add("dark");

const mount = document.getElementById("mount");
let element;
if (mode === "panel") {
  element = document.createElement("domotwin-panel");
  element.narrow = false;
} else {
  mount.classList.add("card");
  element = document.createElement("domotwin-card");
  element.setConfig({
    type: "custom:domotwin-card",
    title: params.get("title") ?? undefined,
    view: params.get("view") ?? undefined,
    cutaway: params.get("cutaway") ?? undefined,
    lighting: params.get("lighting") ?? undefined,
  });
}
element.hass = hass;
mount.append(element);
window.__element = element;
window.__view = () =>
  element.shadowRoot?.querySelector("domotwin-view") ??
  element.shadowRoot?.querySelector("ha-card domotwin-view");
