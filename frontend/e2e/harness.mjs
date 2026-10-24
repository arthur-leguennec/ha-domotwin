// A mocked Home Assistant around the real built frontend. Query parameters:
//   mode=card|panel  lang=en|fr  plan=demo|none  admin=1|0  dark=1  view=3d|2d  cutaway=auto|always|off
//   lighting=auto|morning|day|evening|night  sun=<elevation>,<rising 0|1> (a sun.sun entity)
//   live=1 (the demo bindings, and the demo home's entities, areas and states)
//   models=1 (the demo plan with a bar stool drawn from examples/models/stool.glb, twice)
//   models=big (the same pieces drawn from a generated STL of 139 392 triangles)
//   models=unused (the stool model in the plan, without pieces)
//   layer=off|temperature|humidity|co2|pm25|power  alerts=0  presence=0 (card options)
//   sunpos=<azimuth>,<elevation> (sun.sun's position)  realsun=1 (card option sun: real)
//   north=<degrees> (the stored settings)  badges=0  cameras=0 (card options)
//   storeys=2 (the fictional upper floor above the demo apartment)  storey=<id> (card option)
import { applyService, demoHome } from "./demo-home.mjs";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "card";
const live = params.get("live") === "1";

await import("/domotwin_static/domotwin.js?v=e2e");

const demo = await (await fetch("/examples/demo-apartment.plan.json")).json();
const demoBindings = live
  ? await (await fetch("/examples/demo-apartment.bindings.json")).json()
  : { version: 1, rooms: {}, elements: {} };
const storeys = [];
if (params.get("plan") !== "none") {
  storeys.push({ id: "storey-1", name: "", elevation: 0, plan: demo, layout: {} });
  if (params.get("storeys") === "2") {
    const upper = await (await fetch("/examples/demo-upper-floor.plan.json")).json();
    storeys.push({ id: "storey-2", name: "", elevation: 280, plan: upper, layout: {} });
  }
}
/** The storeys lowest first; the ground floor (nearest elevation 0, the lower of two as near). */
const sorted = () => [...storeys].sort((a, b) => a.elevation - b.elevation);
const ground = () =>
  sorted().reduce(
    (best, storey) => (Math.abs(storey.elevation) < Math.abs(best.elevation) ? storey : best),
    sorted()[0],
  );
/** A storey by id (the ground floor without; an error for an unknown id). */
function storeyOf(id) {
  if (id === undefined) return ground();
  const found = storeys.find((storey) => storey.id === id);
  if (!found) throw { code: "unknown_storey", message: "no storey has this id" };
  return found;
}
/** The ids a storey uses: its plan's elements and the pieces its overlay adds. */
const idsOf = (plan, layout = {}) => [
  ...(plan?.elements ?? []).map((e) => e.id),
  ...Object.entries(layout)
    .filter(([, entry]) => entry && "add" in entry)
    .map(([id]) => id),
];
/** Element ids are the home's: none may be another storey's. */
function checkIds(plan, except, layout = {}) {
  const taken = new Set(
    storeys.filter((s) => s !== except).flatMap((s) => idsOf(s.plan, s.layout)),
  );
  if (idsOf(plan, layout).some((id) => taken.has(id))) {
    throw { code: "duplicate_id", message: "ids used on another storey" };
  }
}
function newStorey(fields) {
  let n = 1;
  while (storeys.some((s) => s.id === `storey-${n}`)) n += 1;
  const storey = { id: `storey-${n}`, name: "", elevation: 0, layout: {}, ...fields };
  storeys.push(storey);
  return storey;
}
const store = {
  storeys,
  // The ground floor's plan and overlay (the tests of a single storey use these).
  get plan() {
    return ground()?.plan ?? null;
  },
  set plan(plan) {
    const shown = ground();
    if (shown) shown.plan = plan;
    else if (plan) newStorey({ plan });
  },
  get layout() {
    return ground()?.layout ?? {};
  },
  set layout(layout) {
    const shown = ground();
    if (shown) shown.layout = layout;
  },
  bindings: demoBindings,
  revision: 1,
  settings: params.get("north") ? { north: Number(params.get("north")) } : {},
  /** Model files kept by the mocked integration, by `<sha256>.<format>`. */
  files: new Map(),
};
window.__store = store;

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A wavy square of 264 × 264 cells (139 392 triangles) as a binary STL, Z up, millimetres. */
function bigStl() {
  const cells = 264;
  const bytes = new Uint8Array(84 + 50 * 2 * cells * cells);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 2 * cells * cells, true);
  const z = (i, j) => 300 + 60 * Math.sin(i / 9) * Math.cos(j / 13);
  let at = 84;
  const corner = (i, j) => [i * 1.5, j * 1.5, z(i, j)];
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      const a = corner(i, j);
      const b = corner(i + 1, j);
      const c = corner(i + 1, j + 1);
      const d = corner(i, j + 1);
      for (const triangle of [
        [a, b, c],
        [a, c, d],
      ]) {
        at += 12;
        for (const p of triangle) {
          for (const v of p) {
            view.setFloat32(at, v, true);
            at += 4;
          }
        }
        at += 2;
      }
    }
  }
  return bytes;
}

const modelsParam = params.get("models");
if (modelsParam && store.plan) {
  const big = modelsParam === "big";
  const bytes = big
    ? bigStl()
    : new Uint8Array(await (await fetch("/examples/models/stool.glb")).arrayBuffer());
  const format = big ? "stl" : "glb";
  const hash = await sha256(bytes);
  store.files.set(`${hash}.${format}`, bytes);
  store.plan.models = {
    "m-stool": {
      name: "Bar stool",
      size: [38, 38, 71],
      file: { format, hash, bytes: bytes.length, up: big ? "z" : "y" },
    },
  };
  for (const [id, x] of modelsParam === "unused"
    ? []
    : [
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
      case "domotwin/plan/get": {
        const storey = storeyOf(message.storey);
        return structuredClone({
          plan: storey?.plan ?? null,
          layout: storey?.layout ?? {},
          storey: storey?.id ?? null,
          storeys: sorted().map(({ id, name, elevation }) => ({ id, name, elevation })),
          revision: store.revision,
        });
      }
      case "domotwin/bindings/get":
        return structuredClone({ bindings: store.bindings, revision: store.revision });
      case "domotwin/settings/get":
        return structuredClone({ settings: store.settings, revision: store.revision });
      case "domotwin/settings/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        store.settings = message.settings;
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "settings", revision: store.revision });
        return { revision: store.revision };
      }
      case "domotwin/plan/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        let target = storeyOf(message.storey);
        if (message.plan !== null) {
          checkIds(message.plan ?? target?.plan, target, message.layout ?? target?.layout);
        }
        if (!target && message.plan) target = newStorey({ plan: message.plan });
        if (target && message.plan === null) storeys.splice(storeys.indexOf(target), 1);
        else if (target) {
          if (message.plan) target.plan = message.plan;
          if ("layout" in message) target.layout = message.layout;
        }
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "plan", revision: store.revision });
        return { revision: store.revision };
      }
      case "domotwin/storey/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        let target = message.storey === undefined ? undefined : storeyOf(message.storey);
        if ("plan" in message || "layout" in message) {
          checkIds(message.plan ?? target?.plan, target, message.layout ?? target?.layout);
        }
        if (!target) {
          if (!message.plan) throw { code: "invalid_storey", message: "a new storey needs a plan" };
          target = newStorey({ plan: message.plan });
        }
        for (const key of ["name", "elevation", "plan", "layout"]) {
          if (key in message) target[key] = message[key];
        }
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "plan", revision: store.revision });
        return { revision: store.revision, storey: target.id };
      }
      case "domotwin/storeys/replace": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        const ids = message.storeys.flatMap((s) => idsOf(s.plan));
        if (new Set(ids).size !== ids.length) {
          throw { code: "duplicate_id", message: "ids used on two storeys" };
        }
        storeys.splice(0, storeys.length);
        for (const { plan, name = "", elevation = 0 } of message.storeys) {
          newStorey({ plan, name, elevation });
        }
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "plan", revision: store.revision });
        return { revision: store.revision, storeys: storeys.map((s) => s.id) };
      }
      case "domotwin/storey/remove": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        const target = storeyOf(message.storey);
        storeys.splice(storeys.indexOf(target), 1);
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
const sunPosition = params.get("sunpos");
const home = live ? demoHome() : { states: {}, entities: {}, devices: {}, areas: {} };
if (live && params.get("storeys") === "2") {
  // The upper floor's office, with a smoke sensor.
  home.areas.office = { area_id: "office", name: "Office" };
  home.entities["binary_sensor.office_smoke"] = {
    entity_id: "binary_sensor.office_smoke",
    area_id: "office",
  };
  home.states["binary_sensor.office_smoke"] = {
    entity_id: "binary_sensor.office_smoke",
    state: "off",
    attributes: { device_class: "smoke", friendly_name: "Office smoke" },
  };
}
const states = home.states;
if (sunParam) {
  const [elevation, rising] = sunParam.split(",");
  states["sun.sun"] = {
    entity_id: "sun.sun",
    state: Number(elevation) > 0 ? "above_horizon" : "below_horizon",
    attributes: { elevation: Number(elevation), rising: rising === "1" },
  };
}
if (sunPosition) {
  const [azimuth, elevation] = sunPosition.split(",").map(Number);
  states["sun.sun"] = {
    entity_id: "sun.sun",
    state: elevation > 0 ? "above_horizon" : "below_horizon",
    attributes: { azimuth, elevation, rising: azimuth < 180 },
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
    layer: params.get("layer") ?? undefined,
    alerts: params.get("alerts") === "0" ? false : undefined,
    presence: params.get("presence") === "0" ? false : undefined,
    sun: params.get("realsun") === "1" ? "real" : undefined,
    badges: params.get("badges") === "0" ? false : undefined,
    cameras: params.get("cameras") === "0" ? false : undefined,
    storey: params.get("storey") ?? undefined,
  });
}
element.hass = hass;
mount.append(element);
window.__element = element;
window.__view = () =>
  element.shadowRoot?.querySelector("domotwin-view") ??
  element.shadowRoot?.querySelector("ha-card domotwin-view");
