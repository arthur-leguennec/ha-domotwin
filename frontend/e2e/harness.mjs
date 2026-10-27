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
//   theme=auto|day|neon|blueprint|cartoon|clay  accent=<#rrggbb>  names=0 (card options)
//   hometheme=<look> (the stored settings)
//   screen=<name>  idle=<seconds>  orbit=1  nightdim=1 (the kiosk's card options)
//   wifi=typed|image (the home's Wi-Fi for guests, D-060: a fictional network, or a router's code)
//   wifiscreens=<names> (the screens that show it, comma-separated)  tools=0 (the card's tools hidden)
//   overview=1 (Home Assistant 2026.10, its Overview with an area page each; DomoTwin's room and
//   upkeep sensors, who is home: D-061)  mode=summary&summary=<kind> (a summary card)
//   nopanel=1 (no DomoTwin panel for this user: left out of the sidebar, or for administrators)
//   upkeep=1 (the demo apartment's fictional upkeep cards, examples/demo-apartment.upkeep.json)
//   upkeep=0 (an integration without upkeep cards)
//   people=1 (fictional people: Alex, the user viewing, in the kitchen; Sam in the living room;
//   Kim away), people=0 (an integration without people)  peopleshown=admins  peoplelook=pin
//   window.__move(person, room) moves someone (their room sensor, as the integration writes it)
//   bluetooth=1 (DomoTwin's own Bluetooth locating: three fictional receivers, Alex's phone and
//   keys followed, both in the kitchen, the keys left behind), bluetooth=none (no Bluetooth)
//   radios=1 (the radio coverage, D-066: two of the receivers placed, the hall taught, two Wi-Fi
//   devices reporting their signal, an access point in the kitchen's far corner)
//   window.__show(request) sends a `domotwin.show` request to every screen
//   private=<room>,<room> (private rooms, D-039, kept for nobody), privatefor=<person> (kept for
//   that person instead), privatewhile=<entity> (private only while it is on), settingsdown=1
//   (the settings cannot be read until window.__settingsUp())
//   voice=1 (Assist with a pipeline that hears), voice=deaf (Assist that cannot hear),
//   robot=1 (a robot vacuum's dock in the hall, linked to vacuum.robbie, docked; D-049)
//   valetudo=1 (a robot running Valetudo: its vacuum and its Map data camera over MQTT, whose
//   picture is the fictional map of crates/domotwin-import/tests/fixtures/robot.png; D-064),
//   valetudo=2 (two of them)
//   energy=1 (fictional solar panels, meter and battery, named in the stored settings; D-049)
//   peak=hydroqc|hydropeak|calendar (Hydro-Québec's peaks, D-063: hydroqc's Flex D sensors,
//   HydroPeak's, or the calendar hydroqc writes its peaks in), peakphase=upcoming|preheat|peak|none
//   (where the peak stands now; `peak` unless asked), with the bedroom heating and the living
//   room's thermostat set back
//   demo=1 (the card's `demo`: the demo house instead of this home, D-050)
//   supervisor=1 (apps can be installed), blueprints=changed (one edited), insecure=1 (a page
//   served over HTTP: no microphone), mic=0 (the card's microphone turned off)
//   start=home|rooms|3d|none (the tab this device opens on, D-055: 3d unless asked; none: the
//   user's), userstart=<tab> (the user's), favourites=<id>,<id> (the user's), route=1 (Home
//   Assistant's address: /domotwin and the path after it, navigation and back as it does them)
//   path=<path after /domotwin> (the address opened, with route=1), cards=1 (Home Assistant's
//   card helpers, made up: a card says its type and entity), lists=1 (a calendar and a to-do
//   list), firstpage=device|user (how Home Assistant keeps the page it opens first)
//   sandbox=1 (D-057: Home Assistant's time zone and a fictional place; with automations=1, two
//   automations working against each other, one set off from outside, and a script)
//   Home Assistant's history, statistics and logbook (D-058) answer a fictional day of the
//   bedroom (`HISTORY` below); historyfail=1 makes the history refuse, nostats=1 leaves the
//   statistics out; formatstate=1 gives `hass.formatEntityState` (states in words, "°C" after).
//   weather=<condition> (D-067: a fictional `weather.home` in that condition, wind 18 km/h from
//   the south-west, and a `weather.coast` pouring), homeweather=<entity|none> (the stored
//   settings' choice), weatheroption=0 (the card's `weather: false`)
//   why=1 (D-059: Home Assistant's logbook and traces of a fictional evening, with live=1: the
//   entrance door opened five minutes ago and set off "Hall light at the door", which lit the
//   hall's spots; Sam switched the floor lamp on two minutes ago; the kitchen's ceiling light was
//   switched off on its own switch)
//   confighistory=1 (the configuration history, D-062: fictional automations, a script removed,
//   one in YAML files of one's own and a dashboard, as the integration keeps them; Home
//   Assistant's configuration API and `lovelace/config/save` put one back, read again on
//   `domotwin/config_history/refresh`; window.__refuseConfig = "<message>" makes Home Assistant
//   refuse)
import { applyService, demoHome } from "./demo-home.mjs";

const params = new URLSearchParams(location.search);
// The tip on what a tap does (D-047) is read already, unless a test looks at it.
try {
  if (params.get("tip") === "1") localStorage.removeItem("domotwin-tip-tap");
  else localStorage.setItem("domotwin-tip-tap", "read");
} catch {
  // No storage: the tip shows.
}
const mode = params.get("mode") ?? "card";
// The tab this device opens on (D-055): the 3D view, as before the tabs, unless a test asks.
try {
  const start = params.get("start") ?? "3d";
  if (start === "none") localStorage.removeItem("domotwin-start");
  else localStorage.setItem("domotwin-start", start);
} catch {
  // Storage disabled.
}
const live = params.get("live") === "1";
// A mocked ZHA (D-031): a fictional Zigbee mesh over the demo apartment.
const zha = params.get("zha") === "1";
// Fictional automations (D-032): `automations=1` three of them, `automations=50` as many made up.
const automationCount = Number(params.get("automations") ?? 0);
const sandbox = params.get("sandbox") === "1";
// Home Assistant's logbook and traces of a fictional evening (D-059).
const why = params.get("why") === "1";
/** The logbook's rows, as `logbook/get_events` gives them, each with the context it is in. */
let whyRows = [];
// Their contexts' ids, as Home Assistant writes them (ULIDs).
const C_DOOR = "01K8C0D00R0000000000000001";
const C_RUN = "01K8C0D00R0000000000000002";
const C_SAM = "01K8C0D00R0000000000000003";
const C_KITCHEN = "01K8C0D00R0000000000000004";
// Voice (D-041): Assist and its pipelines, the voice blueprints, apps to install.
const voiceParam = params.get("voice");
if (params.get("insecure") === "1") {
  Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
}
const voice = {
  pipelines: [
    { id: "home-assistant", name: "Home Assistant", stt_engine: null },
    ...(voiceParam === "1" ? [{ id: "whisper", name: "Whisper", stt_engine: "stt.whisper" }] : []),
  ],
  preferred: "home-assistant",
  blueprints: {
    show_by_voice: "missing",
    where_by_voice: params.get("blueprints") === "changed" ? "changed" : "missing",
  },
  setup: { step: "idle", app: null, error: null, pipeline: null },
};
const SETUP_STEPS = ["checking", "installing", "starting", "connecting", "pipeline", "done"];

await import("/domotwin_static/domotwin.js?v=e2e");

const demo = await (await fetch("/examples/demo-apartment.domotwin.json")).json();
const demoBindings = live
  ? await (await fetch("/examples/demo-apartment.bindings.json")).json()
  : { version: 1, rooms: {}, elements: {} };
// A robot vacuum (D-049): its dock against the hall's far wall, facing in.
const robot = params.get("robot") === "1";
if (robot) {
  demo.items.push({
    id: "robot-dock",
    name: "Robot vacuum",
    kind: "robot-vacuum",
    at: [340, 735],
    size: [40, 50, 12],
    rotation: 180,
    room: "hall",
  });
  demoBindings.elements["robot-dock"] = { entities: [{ entity_id: "vacuum.robbie" }] };
}
// Upkeep cards (D-033): the demo's, none yet, or an integration without them.
const upkeepParam = params.get("upkeep");
const demoUpkeep =
  upkeepParam === "1"
    ? await (await fetch("/examples/demo-apartment.upkeep.json")).json()
    : { version: 1, lead_days: 14, pieces: {} };

// People in their rooms (D-034): fictional people, their room sensors written as the integration
// writes them.
const peopleParam = params.get("people");
const PEOPLE = {
  "person.alex": { name: "Alex Martin", color: "#e8508a", room: "kitchen", home: true },
  "person.sam": { name: "Sam", color: "#2f9fd8", room: "living", home: true },
  "person.kim": { name: "Kim", color: "#3fae5a", room: undefined, home: false },
};

// Bluetooth locating (D-035): fictional receivers and devices, their room sensors as the
// integration writes them.
const bluetoothParam = params.get("bluetooth");
const LOCATED = {
  alex_phone: {
    name: "Alex's phone",
    kind: "phone",
    person: "person.alex",
    match: { key: "entry-alex-phone", title: "Alex's iPhone" },
    room: "kitchen",
    roomName: "Kitchen",
    left_behind: false,
  },
  keys: {
    name: "Keys",
    kind: "thing",
    person: "person.alex",
    match: { address: "F1:00:00:00:00:01" },
    room: "kitchen",
    roomName: "Kitchen",
    left_behind: true,
  },
};

/** Today's date where the mocked home is (the browser's time zone), as the integration gives it. */
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const storeys = [];
if (params.get("plan") !== "none") {
  storeys.push({ id: "storey-1", name: "", elevation: 0, plan: demo, layout: {} });
  if (params.get("storeys") === "2") {
    const upper = await (await fetch("/examples/demo-upper-floor.domotwin.json")).json();
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
/** The lists of a plan file. */
const LISTS = ["rooms", "partitions", "doors", "windows", "items"];
/** The ids a storey uses: its plan's elements and the pieces its overlay adds. */
const idsOf = (plan, layout = {}) => [
  ...LISTS.flatMap((list) => plan?.[list] ?? []).map((e) => e.id),
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
  bindings: zha
    ? {
        ...demoBindings,
        elements: {
          ...demoBindings.elements,
          // The coordinator has no entity: the sideboard stands for its device.
          sideboard: { device: "dev-coordinator", entities: [] },
        },
      }
    : demoBindings,
  revision: 1,
  settings: {
    ...(params.get("north") ? { north: Number(params.get("north")) } : {}),
    ...(params.get("hometheme") ? { theme: params.get("hometheme") } : {}),
    ...(params.get("homeweather") ? { weather: params.get("homeweather") } : {}),
    ...(params.get("energy") === "1"
      ? {
          energy: {
            solar: "sensor.solar_power",
            grid: "sensor.grid_power",
            battery: "sensor.home_battery_power",
            battery_level: "sensor.home_battery_level",
          },
        }
      : {}),
    ...(params.get("private")
      ? {
          rooms: Object.fromEntries(
            params
              .get("private")
              .split(",")
              .map((room) => [
                room,
                {
                  people: params.get("privatefor") ? [params.get("privatefor")] : [],
                  ...(params.get("privatewhile") ? { while: params.get("privatewhile") } : {}),
                },
              ]),
          ),
        }
      : {}),
  },
  /** Model files kept by the mocked integration, by `<sha256>.<format>`. */
  files: new Map(),
  upkeep: demoUpkeep,
  people: {
    revision: 1,
    shown: params.get("peopleshown") ?? "everyone",
    look: params.get("peoplelook") ?? "figure",
    hidden: [],
    people:
      peopleParam === "1"
        ? Object.fromEntries(
            Object.entries(PEOPLE).map(([id, p]) => [
              id,
              { sources: [`sensor.${id.slice(7)}_phone_area`], color: p.color },
            ]),
          )
        : {},
  },
};
store.locating = {
  revision: 1,
  status: bluetoothParam === "none" ? "no_bluetooth" : "ready",
  learn: true,
  receivers:
    bluetoothParam === "none"
      ? []
      : [
          {
            source: "AA:00:00:00:00:03",
            name: "living-proxy",
            idle: 1,
            placed_by: "device_area",
          },
          {
            source: "BB:00:00:00:00:01",
            name: "bedroom-proxy",
            idle: 2,
            room: "bedroom",
            placed_by: "room",
          },
          { source: "CC:00:00:00:00:01", name: "hall-proxy", idle: 4, placed_by: null },
        ],
  devices: Object.fromEntries(
    Object.entries(bluetoothParam === "1" ? LOCATED : {}).map(([id, d]) => [
      id,
      {
        name: d.name,
        kind: d.kind,
        person: d.person,
        match: d.match,
        sensor: `sensor.domotwin_${id}_bluetooth`,
        room: d.room,
        confidence: 0.87,
        last_seen: new Date().toISOString(),
        left_behind: d.left_behind,
        missing_key: false,
      },
    ]),
  ),
  learned: {},
  rooms: [
    { id: "living", name: "Living room", storey: "" },
    { id: "kitchen", name: "Kitchen", storey: "" },
    { id: "bathroom", name: "Bathroom", storey: "" },
    { id: "hall", name: "Hall", storey: "" },
    { id: "bedroom", name: "Bedroom", storey: "" },
  ],
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
    store.plan.items.push({
      id,
      name: "Bar stool",
      model: "m-stool",
      at: [x + 19, 299],
      size: [38, 38, 71],
      room: "living",
    });
  }
}

/**
 * The integration's model file views (`/api/domotwin/models`), and the cameras' pictures
 * (`/api/camera_proxy`), with the user's session.
 */
async function fetchWithAuth(path, init = {}) {
  calls.push({ type: "fetch", method: init.method ?? "GET", path });
  const url = new URL(path, location.origin);
  if (url.pathname.startsWith("/api/camera_proxy/")) {
    const camera = decodeURIComponent(url.pathname.slice("/api/camera_proxy/".length));
    if (!home.states[camera]) return new Response("", { status: 404 });
    // Valetudo's map for Home Assistant: a picture holding the robot's map.
    return fetch("/fixtures/robot.png");
  }
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
// The configuration history (D-062), as the integration keeps it: each item's versions, oldest
// first, and what Home Assistant's editors saved since it last read them.
const configItems = params.get("confighistory") === "1" ? fictionalConfigHistory() : [];
const configPending = new Map();
let configNext = 100;

function fictionalConfigHistory() {
  const day = 86_400_000;
  const at = (days) => new Date(Date.parse("2026-10-26T18:00:00Z") - days * day).toISOString();
  const evening = (offset, actions) => ({
    id: "1700000000001",
    alias: "Evening lights",
    triggers: [{ trigger: "sun", event: "sunset", offset }],
    actions,
    mode: "single",
  });
  const lamp = { action: "light.turn_on", target: { entity_id: "light.living_lamp" } };
  const curtains = { action: "cover.close_cover", target: { entity_id: "cover.living_curtains" } };
  return [
    {
      kind: "automation",
      key: "1700000000001",
      name: "Evening lights",
      source: "editor",
      versions: [
        { id: 1, at: at(9), config: evening("-00:30:00", [lamp]) },
        { id: 2, at: at(3), config: evening("-00:30:00", [lamp, curtains]) },
        { id: 3, at: at(1), config: evening("-00:20:00", [lamp, curtains]) },
      ],
    },
    {
      kind: "script",
      key: "good_night",
      name: "Good night",
      source: "editor",
      versions: [
        {
          id: 4,
          at: at(5),
          config: { alias: "Good night", sequence: [{ action: "light.turn_off" }] },
        },
        { id: 5, at: at(2), config: null },
      ],
    },
    {
      kind: "automation",
      key: "hall_motion",
      name: "Hall light on motion",
      source: "yaml",
      versions: [
        {
          id: 6,
          at: at(7),
          config: { alias: "Hall light on motion", triggers: [], actions: [lamp] },
        },
        {
          id: 7,
          at: at(4),
          config: { alias: "Hall light on motion", triggers: [], actions: [lamp, curtains] },
        },
      ],
    },
    {
      kind: "dashboard",
      key: "",
      name: null,
      source: "editor",
      versions: [{ id: 8, at: at(6), config: { title: "Home", views: [{ title: "Kitchen" }] } }],
    },
  ];
}

function configSummary(item) {
  const newest = item.versions.at(-1);
  return {
    id: `${item.kind}:${item.key}`,
    kind: item.kind,
    key: item.key,
    name: item.name,
    source: item.source,
    removed: newest.config === null,
    versions: item.versions.length,
    changed: newest.at,
  };
}

function configItem(id) {
  if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
  const item = configItems.find((each) => `${each.kind}:${each.key}` === id);
  if (!item) throw { code: "unknown_item", message: "unknown_item" };
  return item;
}

/** Home Assistant's configuration API (`hass.callApi`): its editors' save. */
async function callApi(method, path, parameters) {
  calls.push({ type: "api", method, path, parameters });
  if (!hass.user.is_admin) throw { error: "Response error: 401", status_code: 401, body: {} };
  if (window.__refuseConfig) {
    const message = window.__refuseConfig;
    throw { error: "Response error: 400", status_code: 400, body: { message } };
  }
  const found = /^config\/(automation|script|scene)\/config\/(.+)$/.exec(path);
  if (method !== "POST" || !found) throw { error: "Response error: 404", status_code: 404 };
  configPending.set(`${found[1]}:${decodeURIComponent(found[2])}`, structuredClone(parameters));
  return { result: "ok" };
}

const listeners = new Set();
// Actions done later (D-046), as the integration lists them to its subscribers.
const schedules = [];
const scheduleListeners = new Set();
let scheduleCount = 0;
const publishSchedules = () => {
  for (const listener of scheduleListeners) listener({ schedules: structuredClone(schedules) });
};
const SCHEDULABLE = ["light", "switch", "fan", "input_boolean", "media_player", "cover"];
/** The next time `hhmm` comes (the browser's clock), or a date. */
const nextMoment = (moment) => {
  const clock = /^(\d{2}):(\d{2})$/.exec(moment);
  if (!clock) return new Date(moment);
  const at = new Date();
  at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
  if (at <= new Date()) at.setDate(at.getDate() + 1);
  return at;
};
const calls = [];
window.__calls = calls;
// settingsdown=1: the settings cannot be read until `window.__settingsUp()` (D-039).
let settingsDown = params.get("settingsdown") === "1";
/** The home's Wi-Fi for guests (D-060), as the integration keeps it: fictional. */
let wifi =
  params.get("wifi") === "typed"
    ? {
        name: "Fictional Guests",
        password: "tea-and-cake-42",
        security: "WPA",
        hidden: false,
        screens: params.get("wifiscreens") ? params.get("wifiscreens").split(",") : [],
      }
    : params.get("wifi") === "image"
      ? {
          image: "image.router_guest_wifi",
          security: "WPA",
          hidden: false,
          screens: params.get("wifiscreens") ? params.get("wifiscreens").split(",") : [],
        }
      : undefined;
window.__wifi = () => wifi;
/** What `domotwin/wifi/get` answers, as the integration does: its password only when asked. */
window.__wifiAsked = [];
function wifiAnswer(admin, screen, password) {
  window.__wifiAsked.push({ screen, password });
  if (!wifi) return { set: false, shown: false };
  const chosen = wifi.screens.some((name) => name.toLowerCase() === screen.toLowerCase());
  if (!admin && !(screen && chosen)) return { set: true, shown: false };
  const { screens, password: secret, ...shown } = wifi;
  return {
    set: true,
    shown: true,
    ...shown,
    ...(password && secret !== undefined ? { password: secret } : {}),
    ...(admin ? { screens: [...screens] } : {}),
  };
}
let wifiRevision = 0;
/** The user's own choices (D-055). */
const choices = {
  favourites: params.get("favourites") ? params.get("favourites").split(",") : [],
  cards: [],
  ...(params.get("userstart") ? { start: params.get("userstart") } : {}),
};
window.__choices = choices;
window.__settingsUp = () => {
  settingsDown = false;
  for (const listener of listeners) listener({ kind: "settings", revision: store.revision });
};
// `domotwin.show` (D-029), as the integration sends it to every screen.
window.__show = (request) => {
  for (const listener of listeners) listener({ kind: "show", show: request });
};

/** For the sandbox (D-057): automations working against each other, and one set off by MQTT. */
const SANDBOX_AUTOMATIONS = {
  "automation.away_lamp_off": {
    id: "1101",
    alias: "Lamp off when Alex goes out",
    triggers: [{ trigger: "state", entity_id: "person.alex", to: "not_home" }],
    actions: [{ action: "light.turn_off", target: { entity_id: "light.living_room_floor_lamp" } }],
  },
  "automation.lamp_back_on": {
    id: "1102",
    alias: "Lamp back on",
    triggers: [{ trigger: "state", entity_id: "light.living_room_floor_lamp", to: "off" }],
    actions: [{ action: "light.turn_on", target: { entity_id: "light.living_room_floor_lamp" } }],
  },
  "automation.doorbell_from_outside": {
    id: "1103",
    alias: "Doorbell",
    triggers: [{ trigger: "mqtt", topic: "home/doorbell" }],
    actions: [{ action: "script.movie_night" }],
  },
};

/** For the sandbox: a script, as Home Assistant's script editor keeps it. */
const SANDBOX_SCRIPTS = {
  "script.movie_night": {
    alias: "Movie night",
    sequence: [
      { action: "light.turn_off", target: { area_id: "living_room" } },
      { action: "cover.close_cover", target: { entity_id: "cover.living_room_curtains" } },
    ],
  },
};

/** Fictional automations of the demo apartment, by entity id, with their configurations. */
function automationConfigs() {
  if (automationCount <= 0) return {};
  if (automationCount === 1) {
    return {
      ...(sandbox ? SANDBOX_AUTOMATIONS : {}),
      "automation.evening_lights": {
        id: "1001",
        alias: "Evening lights",
        triggers: [
          { trigger: "sun", event: "sunset" },
          { trigger: "state", entity_id: "binary_sensor.entrance_door_contact", to: "on" },
        ],
        conditions: [
          { condition: "state", entity_id: "binary_sensor.living_room_motion", state: "on" },
        ],
        actions: [
          {
            action: "light.turn_on",
            target: { entity_id: ["light.living_room_floor_lamp", "light.sideboard_lamp"] },
          },
        ],
      },
      "automation.movie_time": {
        id: "1002",
        alias: "Movie time",
        triggers: [{ trigger: "state", entity_id: "media_player.living_room_tv", to: "playing" }],
        conditions: ["{{ is_state('sun.sun', 'below_horizon') }}"],
        actions: [
          { action: "light.turn_off", target: { area_id: "living_room" } },
          { action: "cover.close_cover", target: { entity_id: "cover.living_room_curtains" } },
        ],
      },
      "automation.goodnight": {
        id: "1003",
        alias: "Goodnight",
        triggers: [{ trigger: "time", at: "23:00:00" }],
        actions: [
          {
            action: "light.turn_off",
            target: { entity_id: ["light.bedside_left", "light.bedside_right"] },
          },
          { action: "notify.phone", data: { message: "Goodnight" } },
          { action: "{{ 'light.turn_' ~ mode }}", target: { entity_id: "light.kitchen_ceiling" } },
        ],
      },
    };
  }
  // Made up, for the frame time: each from a sensor or a time to two lights.
  const sensors = Object.keys(home.states).filter((id) => id.startsWith("binary_sensor."));
  const lights = Object.keys(home.states).filter((id) => id.startsWith("light."));
  return Object.fromEntries(
    Array.from({ length: automationCount }, (_, i) => [
      `automation.made_up_${i}`,
      {
        id: String(2000 + i),
        alias: `Made up ${i}`,
        triggers: [
          i % 3 === 0
            ? { trigger: "time", at: "07:00:00" }
            : { trigger: "state", entity_id: sensors[i % sensors.length] },
        ],
        actions: [
          {
            action: "light.toggle",
            target: { entity_id: [lights[i % lights.length], lights[(i * 7 + 3) % lights.length]] },
          },
        ],
      },
    ]),
  );
}

/** A fictional mesh, as ZHA's `zha/devices` describes it (`last_seen` in local time, no zone). */
function zhaDevices() {
  const ago = (seconds) => {
    const d = new Date(Date.now() - seconds * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const ieee = (n) => `00:12:4b:00:00:00:00:0${n}`;
  const neighbour = (n, lqi, relationship, device_type = "Router") => ({
    ieee: ieee(n),
    nwk: `0x000${n}`,
    lqi: String(lqi),
    depth: "1",
    relationship,
    device_type,
    rx_on_when_idle: "On",
    permit_joining: "Unknown",
    extended_pan_id: "dd:dd:dd:dd:dd:dd:dd:dd",
  });
  const device = (n, name, device_type, entities, extra) => ({
    ieee: ieee(n),
    nwk: n === 1 ? 0 : 4096 + n,
    name,
    manufacturer: "Fictional",
    model: `Model ${n}`,
    device_type,
    power_source: device_type === "EndDevice" ? "Battery or Unknown" : "Mains",
    available: true,
    lqi: 180,
    rssi: -60,
    last_seen: ago(40),
    entities: entities.map((entity_id) => ({ entity_id, name: entity_id })),
    neighbors: [],
    routes: [],
    ...extra,
  });
  return [
    device(1, "Coordinator", "Coordinator", [], {
      // ZHA reports no quality of its own for the coordinator.
      lqi: null,
      rssi: null,
      device_reg_id: "dev-coordinator",
      neighbors: [
        neighbour(2, 220, "Child"),
        neighbour(3, 170, "Child"),
        neighbour(6, 100, "Child", "EndDevice"),
      ],
    }),
    device(2, "Living room floor lamp", "Router", ["light.living_room_floor_lamp"], {
      neighbors: [
        neighbour(1, 215, "Parent", "Coordinator"),
        neighbour(3, 120, "Sibling"),
        neighbour(5, 95, "Child"),
      ],
    }),
    device(3, "Kitchen ceiling", "Router", ["light.kitchen_ceiling"], {
      neighbors: [
        neighbour(1, 175, "Parent", "Coordinator"),
        neighbour(4, 45, "Child", "EndDevice"),
      ],
    }),
    device(4, "Washing machine plug", "EndDevice", ["sensor.washing_machine_power"], {
      lqi: 45,
      rssi: -88,
    }),
    device(5, "Bedside left", "Router", ["light.bedside_left"], {
      last_seen: ago(2 * 86400),
      available: false,
    }),
    device(
      6,
      "Garden sensor",
      "EndDevice",
      ["sensor.garden_temperature", "sensor.garden_sensor_lqi"],
      {
        lqi: 100,
      },
    ),
  ];
}

// What Home Assistant's recorder has (D-058), for a fictional day before now (each entity's state
// 25 hours ago first, before the last 24 hours begin): the bedroom above
// 24 °C for an hour and a half (5 hours ago), then again for 40 minutes (now); its bedside lamp
// switched on and off; the front door locked by an automation. [minutes before now, state, cause]
const HISTORY = {
  "sensor.bedroom_temperature": [
    [25 * 60, "22.8"],
    [5 * 60, "24.5"],
    [4 * 60, "25.1"],
    [3 * 60 + 30, "23.6"],
    [40, "24.3"],
  ],
  "light.bedside_left": [
    [25 * 60, "off"],
    [3 * 60, "on", { context_user_id: "e2e" }],
    [2 * 60 + 50, "off", { context_name: "Goodnight", context_entity_id: "automation.goodnight" }],
    [30, "on", { context_domain: "light", context_service: "turn_on" }],
  ],
  "lock.entrance_door": [
    [25 * 60, "unlocked"],
    [6 * 60, "locked", { context_name: "Lock at night", context_entity_id: "automation.lock" }],
    [60, "unlocked", { context_user_id: "e2e" }],
  ],
};
const HOUR_MS = 3_600_000;
/** The minutes before now of `HISTORY` as times (ms), from a fixed `now`. */
function historyOf(id, now) {
  return (HISTORY[id] ?? []).map(([before, state, cause]) => ({
    at: now - before * 60_000,
    state,
    cause,
  }));
}
/** `history/history_during_period`: the state at the start, then each change, compressed. */
function historyDuring(message) {
  if (params.get("historyfail") === "1") {
    throw { code: "unknown_error", message: "The recorder is busy" };
  }
  const now = Date.now();
  const start = Date.parse(message.start_time);
  const end = message.end_time ? Date.parse(message.end_time) : now;
  const answer = {};
  for (const id of message.entity_ids) {
    const changes = historyOf(id, now);
    if (changes.length === 0) {
      const state = home.states[id]?.state;
      if (state !== undefined) answer[id] = [{ s: state, lu: start / 1000 }];
      continue;
    }
    const before = changes.filter((c) => c.at <= start).at(-1);
    const list = before ? [{ s: before.state, lu: start / 1000 }] : [];
    for (const change of changes) {
      if (change.at > start && change.at < end)
        list.push({ s: change.state, lu: change.at / 1000 });
    }
    answer[id] = list;
  }
  return answer;
}
/** `recorder/statistics_during_period`: the bedroom's temperature has hourly statistics. */
function statisticsDuring(message) {
  if (params.get("nostats") === "1") return {};
  const start = Math.ceil(Date.parse(message.start_time) / HOUR_MS) * HOUR_MS;
  const last = Math.min(Date.parse(message.end_time ?? new Date().toISOString()), Date.now());
  const answer = {};
  if (message.statistic_ids.includes("sensor.bedroom_temperature")) {
    const hours = [];
    for (let hour = start; hour + HOUR_MS <= last; hour += HOUR_MS) {
      const k = Math.round(hour / HOUR_MS) % 6;
      hours.push({
        start: hour,
        end: hour + HOUR_MS,
        mean: 21 + k * 0.8,
        min: 20.5 + k * 0.8,
        max: 21.6 + k * 0.8,
      });
    }
    answer["sensor.bedroom_temperature"] = hours;
  }
  return answer;
}
/** `logbook/get_events`: the changes in the period, measurements (a unit) left out. */
function logbookEvents(message) {
  const now = Date.now();
  const start = Date.parse(message.start_time);
  const end = message.end_time ? Date.parse(message.end_time) : now;
  const entries = [];
  for (const id of message.entity_ids ?? []) {
    if (id.startsWith("sensor.") && home.states[id]?.attributes.unit_of_measurement) continue;
    for (const change of historyOf(id, now)) {
      if (change.at <= start || change.at >= end) continue;
      entries.push({ when: change.at / 1000, entity_id: id, state: change.state, ...change.cause });
    }
  }
  return entries.sort((a, b) => a.when - b.when);
}

/** The logbook of the fictional evening (D-059): the rows of a context, or of entities, in the
 * time asked. */
function whyEvents(message) {
  const start = Date.parse(message.start_time) / 1000;
  const end = message.end_time ? Date.parse(message.end_time) / 1000 : Infinity;
  return whyRows
    .filter((row) => row.when >= start && row.when <= end)
    .filter((row) =>
      message.context_id
        ? row.context === message.context_id
        : !message.entity_ids || message.entity_ids.includes(row.entry.entity_id),
    )
    .map((row) => row.entry);
}

const connection = {
  sendMessage(message) {
    calls.push(message);
  },
  async sendMessagePromise(message) {
    calls.push(message);
    switch (message.type) {
      case "history/history_during_period":
        return historyDuring(message);
      case "recorder/statistics_during_period":
        return statisticsDuring(message);
      case "logbook/get_events":
        return why ? whyEvents(message) : logbookEvents(message);
      case "zha/devices":
        if (!zha) throw { code: "unknown_command", message: message.type };
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        // A test can hold the answer back (`window.__zhaHold`, a promise).
        await window.__zhaHold;
        return zhaDevices();
      case "search/related": {
        // What Home Assistant relates: automations naming the entity, device or area, or (for an
        // area) an entity in it.
        const configs = automationConfigs();
        const inArea = (id) =>
          message.item_type === "area" && home.entities[id]?.area_id === message.item_id;
        const automation = Object.entries(configs)
          .filter(([, config]) => {
            const text = JSON.stringify(config);
            if (text.includes(`"${message.item_id}"`)) return true;
            return Object.keys(home.states).some((id) => inArea(id) && text.includes(`"${id}"`));
          })
          .map(([id]) => id);
        return automation.length > 0 ? { automation } : {};
      }
      case "script/config": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        const config = (sandbox ? SANDBOX_SCRIPTS : {})[message.entity_id];
        if (!config) throw { code: "not_found", message: "Entity not found" };
        return { config: structuredClone(config) };
      }
      case "config/entity_registry/list":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        return Object.keys(home.states).map((id, k) => ({ id: `e2e${k}`, entity_id: id }));
      case "automation/config": {
        // Kept for administrators, as recent Home Assistant versions do.
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        const config = automationConfigs()[message.entity_id];
        if (!config) throw { code: "not_found", message: "Entity not found" };
        return { config: structuredClone(config) };
      }
      case "domotwin/choices/get":
        return structuredClone(choices);
      case "domotwin/choices/favourite": {
        const others = choices.favourites.filter((id) => id !== message.entity_id);
        choices.favourites = message.favourite ? [...others, message.entity_id] : others;
        return { favourites: [...choices.favourites] };
      }
      case "domotwin/choices/save": {
        if (message.start !== undefined) {
          if (message.start) choices.start = message.start;
          else delete choices.start;
        }
        if (message.cards !== undefined) choices.cards = message.cards;
        return structuredClone(choices);
      }
      case "frontend/set_user_data": {
        hass = { ...hass, userData: message.value };
        if (element) element.hass = hass;
        return null;
      }
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
        if (settingsDown) throw { code: "timeout", message: "Timeout" };
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
      case "domotwin/upkeep/get":
        if (upkeepParam === "0") throw { code: "unknown_command", message: message.type };
        return structuredClone({ upkeep: store.upkeep, revision: store.revision, today: today() });
      case "domotwin/upkeep/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        const pieces = { ...store.upkeep.pieces, ...message.pieces };
        store.upkeep.pieces = Object.fromEntries(
          Object.entries(pieces).filter(([, card]) => card !== null),
        );
        if (message.lead_days !== undefined) store.upkeep.lead_days = message.lead_days;
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "upkeep", revision: store.revision });
        return { revision: store.revision };
      }
      case "domotwin/upkeep/done": {
        const task = store.upkeep.pieces[message.piece]?.tasks?.find((t) => t.id === message.task);
        if (!task) throw { code: "unknown_task", message: "no such task" };
        task.last_done = today();
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "upkeep", revision: store.revision });
        return { revision: store.revision, last_done: task.last_done };
      }
      case "domotwin/people/get": {
        if (peopleParam === "0") throw { code: "unknown_command", message: message.type };
        const people = structuredClone(store.people);
        for (const [id, person] of Object.entries(people.people)) {
          person.sensor = `sensor.domotwin_${id.slice(7)}_room`;
        }
        if (bluetoothParam === "1") {
          people.people["person.alex"].located = ["sensor.domotwin_alex_phone_bluetooth"];
        }
        if (hass.user.is_admin && message.candidates) {
          people.candidates = Object.keys(PEOPLE).map((id) => ({
            entity: `sensor.${id.slice(7)}_watch_area`,
            person: id,
          }));
        }
        return people;
      }
      case "domotwin/people/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        if (
          message.expected_revision !== undefined &&
          message.expected_revision !== store.people.revision
        ) {
          throw { code: "revision_conflict", message: "saved meanwhile" };
        }
        store.people.people = message.people;
        if (message.shown) store.people.shown = message.shown;
        if (message.look) store.people.look = message.look;
        store.people.revision += 1;
        for (const listener of listeners) {
          listener({ kind: "people", revision: store.people.revision });
        }
        return { revision: store.people.revision };
      }
      case "domotwin/wifi/get":
        return wifiAnswer(hass.user.is_admin, message.screen ?? "", message.password === true);
      case "domotwin/wifi/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        const change = message.wifi;
        const next = {
          security: change.security,
          hidden: change.hidden === true,
          screens: change.screens ?? [],
        };
        if (change.image) next.image = change.image;
        else {
          if (!change.name) throw { code: "no_name", message: "no_name" };
          next.name = change.name;
          if (change.security !== "nopass") {
            const same = wifi?.name === change.name && wifi?.security === change.security;
            next.password = change.password ?? (same ? wifi.password : "");
            if (change.security === "WPA" && next.password.length < 8) {
              throw { code: "bad_wpa", message: "bad_wpa" };
            }
          }
        }
        wifi = next;
        wifiRevision += 1;
        for (const listener of listeners) listener({ kind: "wifi", revision: wifiRevision });
        return wifiAnswer(true, "", true);
      }
      case "domotwin/wifi/clear":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        wifi = undefined;
        wifiRevision += 1;
        for (const listener of listeners) listener({ kind: "wifi", revision: wifiRevision });
        return { set: false, shown: false };
      case "domotwin/people/hide": {
        const own = home.states[message.person]?.attributes.user_id === hass.user.id;
        if (!own && !hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        store.people.hidden = store.people.hidden.filter((p) => p !== message.person);
        if (message.hidden) store.people.hidden.push(message.person);
        store.people.revision += 1;
        for (const listener of listeners) {
          listener({ kind: "people", revision: store.people.revision });
        }
        return { revision: store.people.revision };
      }
      case "domotwin/locating/get": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        return structuredClone(store.locating);
      }
      case "domotwin/locating/candidates": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        return {
          candidates: [
            { match: { key: "entry-sam-watch" }, name: "Sam's watch" },
            {
              match: {
                beacon: { uuid: "e2c56db5-dffb-48d2-b060-d0f5a71096e0", major: 1, minor: 2 },
              },
              name: "iBeacon",
              rssi: -63,
            },
            { match: { address: "F1:22:33:44:55:66" }, name: "Bag tag", rssi: -71 },
          ],
        };
      }
      case "domotwin/locating/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        if (
          message.expected_revision !== undefined &&
          message.expected_revision !== store.locating.revision
        ) {
          throw { code: "revision_conflict", message: "saved meanwhile" };
        }
        store.locating.revision += 1;
        for (const listener of listeners) {
          listener({ kind: "locating", revision: store.locating.revision });
        }
        return { revision: store.locating.revision };
      }
      case "domotwin/locating/teach": {
        if (!(message.device in store.locating.devices)) {
          throw { code: "unknown_device", message: "not followed" };
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        store.locating.learned[message.room] = 42;
        return { readings: 14, receivers: 3 };
      }
      case "domotwin/locating/forget": {
        const forgotten = Object.keys(store.locating.learned).length;
        store.locating.learned = {};
        return { forgotten };
      }
      case "assist_pipeline/pipeline/list":
        return { pipelines: structuredClone(voice.pipelines), preferred_pipeline: voice.preferred };
      case "assist_pipeline/pipeline/set_preferred":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        voice.preferred = message.pipeline_id;
        return null;
      case "domotwin/voice/get": {
        // A set-up goes one step further each time it is asked about.
        const at = SETUP_STEPS.indexOf(voice.setup.step);
        if (at >= 0 && at < SETUP_STEPS.length - 1) {
          const step = SETUP_STEPS[at + 1];
          const app = { installing: "Whisper", starting: "Piper" }[step] ?? null;
          voice.setup = { ...voice.setup, step, app };
          if (step === "done") {
            voice.setup.pipeline = "domotwin-local";
            voice.pipelines.push({ id: "domotwin-local", name: "DomoTwin", stt_engine: "stt.w" });
            // The integration makes it the preferred one where the preferred one did not hear.
            if (!voice.pipelines.find((p) => p.id === voice.preferred)?.stt_engine) {
              voice.preferred = "domotwin-local";
            }
          }
        }
        return {
          supervisor: params.get("supervisor") === "1",
          blueprints: { ...voice.blueprints },
          setup: { ...voice.setup },
          language: hass.language,
          piper_voice: hass.language === "fr" ? "fr_FR-siwis-medium" : "en_US-lessac-medium",
        };
      }
      case "domotwin/voice/blueprints":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        for (const [name, status] of Object.entries(voice.blueprints)) {
          if (status === "missing" || message.replace) voice.blueprints[name] = "installed";
        }
        return { blueprints: { ...voice.blueprints } };
      case "domotwin/voice/setup":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        if (params.get("supervisor") !== "1") throw { code: "no_supervisor", message: "no apps" };
        voice.setup = { step: "checking", app: null, error: null, pipeline: null };
        return { ...voice.setup };
      case "domotwin/bindings/save": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        if (window.__failBindings)
          throw { code: "revision_conflict", message: "revision_conflict" };
        store.bindings = message.bindings;
        store.revision += 1;
        for (const listener of listeners) listener({ kind: "bindings", revision: store.revision });
        return { revision: store.revision };
      }
      case "domotwin/schedules/add": {
        if (window.__failSchedules) throw { code: "in_the_past", message: "in_the_past" };
        if (!message.entities.every((id) => SCHEDULABLE.includes(id.split(".")[0]))) {
          throw { code: "not_schedulable", message: "not_schedulable" };
        }
        const at = nextMoment(message.at);
        const until = message.duration
          ? new Date(at.getTime() + message.duration * 1000)
          : message.until
            ? nextMoment(message.until)
            : null;
        scheduleCount += 1;
        const item = {
          id: `schedule-${scheduleCount}`,
          entities: message.entities,
          action: message.action ?? "on",
          at: at.toISOString(),
          until: until?.toISOString() ?? null,
          brightness: message.brightness ?? null,
          started: false,
        };
        schedules.push(item);
        publishSchedules();
        const names = item.entities.map((id) => home.states[id]?.attributes.friendly_name ?? id);
        return { schedule: item, text: `${names.join(", ")} will switch ${item.action}.` };
      }
      case "domotwin/schedules/cancel": {
        const at = schedules.findIndex((item) => item.id === message.schedule_id);
        if (at >= 0) schedules.splice(at, 1);
        publishSchedules();
        return { cancelled: at >= 0 ? 1 : 0 };
      }
      case "trace/contexts":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        return why ? { [C_RUN]: { run_id: "run-1", domain: "automation", item_id: "1004" } } : {};
      case "config/auth/list":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        return [
          { id: "e2e", name: "E2E" },
          { id: "user-sam", name: "Sam" },
        ];
      case "domotwin/config_history/list":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        return {
          items: configItems
            .map(configSummary)
            .sort((a, b) => Date.parse(b.changed) - Date.parse(a.changed)),
          bytes: 12_400,
          max_bytes: 4_000_000,
        };
      case "domotwin/config_history/item": {
        const item = configItem(message.item);
        const seen = new Map();
        const versions = item.versions.map((kept) => {
          const version = {
            id: kept.id,
            at: kept.at,
            removed: kept.config === null,
            kept: kept.config !== null,
          };
          if (kept.config) {
            const text = JSON.stringify(kept.config);
            if (seen.has(text)) version.same_as = seen.get(text);
            seen.set(text, kept.id);
          }
          return version;
        });
        return { item: configSummary(item), versions: versions.reverse() };
      }
      case "domotwin/config_history/version": {
        const kept = configItem(message.item).versions.find((each) => each.id === message.version);
        if (!kept) throw { code: "unknown_version", message: "unknown_version" };
        return { config: structuredClone(kept.config) };
      }
      case "domotwin/config_history/refresh": {
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        let changed = 0;
        for (const [id, config] of configPending) {
          const item = configItems.find((each) => `${each.kind}:${each.key}` === id);
          if (!item || (message.kind && item.kind !== message.kind)) continue;
          item.versions.push({ id: configNext++, at: new Date().toISOString(), config });
          configPending.delete(id);
          changed += 1;
        }
        return { changed };
      }
      case "lovelace/config/save":
        if (!hass.user.is_admin) throw { code: "unauthorized", message: "Unauthorized" };
        configPending.set(`dashboard:${message.url_path ?? ""}`, structuredClone(message.config));
        return null;
      default:
        throw { code: "unknown_command", message: message.type };
    }
  },
  async subscribeMessage(callback, message) {
    calls.push(message);
    if (message.type === "domotwin/schedules/subscribe") {
      scheduleListeners.add(callback);
      queueMicrotask(() => callback({ schedules: structuredClone(schedules) }));
      return async () => scheduleListeners.delete(callback);
    }
    listeners.add(callback);
    return async () => listeners.delete(callback);
  },
};

const language = params.get("lang") ?? "en";
const sunParam = params.get("sun");
const sunPosition = params.get("sunpos");
const home = live ? demoHome() : { states: {}, entities: {}, devices: {}, areas: {} };
if (params.get("energy") === "1") {
  // A sunny afternoon: the sun feeds the home, charges the battery and sends the rest away.
  const power = { device_class: "power", unit_of_measurement: "W" };
  const sensors = {
    "sensor.solar_power": ["3200", { ...power, friendly_name: "Solar panels" }],
    "sensor.grid_power": ["-500", { ...power, friendly_name: "Grid meter" }],
    "sensor.home_battery_power": ["-700", { ...power, friendly_name: "Home battery power" }],
    "sensor.home_battery_level": [
      "78",
      { device_class: "battery", unit_of_measurement: "%", friendly_name: "Home battery" },
    ],
  };
  for (const [id, [state, attributes]] of Object.entries(sensors)) {
    home.states[id] = { entity_id: id, state, attributes };
  }
}
// Robots running Valetudo (D-064): a vacuum and its Map data camera, of MQTT, on one device.
const valetudo = Number(params.get("valetudo") ?? 0);
for (const [k, [id, name]] of [
  ["rockrobo", "Rockrobo"],
  ["dreamy", "Dreamy"],
]
  .slice(0, valetudo)
  .entries()) {
  const device = `dev-valetudo-${k}`;
  home.devices[device] = { id: device, name };
  for (const [entity_id, state, friendly_name] of [
    [`vacuum.${id}`, "docked", name],
    [`camera.${id}_map_data`, "idle", `${name} Map data`],
  ]) {
    home.entities[entity_id] = { entity_id, device_id: device, platform: "mqtt" };
    home.states[entity_id] = { entity_id, state, attributes: { friendly_name } };
  }
}
if (robot) {
  home.entities["vacuum.robbie"] = { entity_id: "vacuum.robbie", area_id: "hallway" };
  home.states["vacuum.robbie"] = {
    entity_id: "vacuum.robbie",
    state: "docked",
    // Starts, pauses, goes home, reports its state.
    attributes: { friendly_name: "Robbie", supported_features: 12_820 },
  };
}
// Hydro-Québec's peaks (D-063), named as a French home names them: they are found by their
// integration and kind, not their id.
const peakSource = params.get("peak");
if (peakSource) {
  const hour = 3_600_000;
  const now = Date.now();
  const phase = params.get("peakphase") ?? "peak";
  // Five hours ahead (pre-heating in three), within the hour, an hour in, or none announced.
  const start = { upcoming: now + 5 * hour, preheat: now + hour, peak: now - hour }[phase];
  const end = start === undefined ? undefined : start + 4 * hour;
  const iso = (time) => (time === undefined ? "unknown" : new Date(time).toISOString());
  const add = (id, state, attributes, entry) => {
    home.states[id] = { entity_id: id, state, attributes };
    if (entry) home.entities[id] = { entity_id: id, ...entry };
  };
  const timestamp = { device_class: "timestamp" };
  if (peakSource === "hydroqc") {
    const entry = (key) => ({ platform: "hydroqc", translation_key: key, device_id: "hq" });
    add(
      "sensor.hydro_quebec_maison_debut_prochaine_pointe",
      iso(start),
      timestamp,
      entry("dpc_next_peak_start"),
    );
    add(
      "sensor.hydro_quebec_maison_fin_prochaine_pointe",
      iso(end),
      timestamp,
      entry("dpc_next_peak_end"),
    );
  } else if (peakSource === "hydropeak") {
    const entry = (key) => ({ platform: "hydropeak", translation_key: key, device_id: "offer" });
    add("sensor.tpc_dpc_evenement_debut", iso(start), timestamp, entry("event_start"));
    add("sensor.tpc_dpc_evenement_fin", iso(end), timestamp, entry("event_end"));
    add(
      "sensor.tpc_dpc_debut_du_prechauffage",
      iso(start && start - 3 * hour),
      timestamp,
      entry("preheat_start"),
    );
  } else if (peakSource === "calendar") {
    // hydroqc's button, which it makes for the peaks it writes in a calendar.
    add("button.hydro_quebec_maison_refresh_peak_data", "unknown", {}, { platform: "hydroqc" });
  }
  if (peakSource === "calendar" && start !== undefined) {
    // A calendar's event, as its attributes say it: a wall clock where Home Assistant is.
    const wall = (time) => {
      const d = new Date(time);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    };
    add("calendar.pointes_hydro", phase === "peak" ? "on" : "off", {
      friendly_name: "Pointes Hydro",
      message: "🔴 Pointe critique",
      location: "Hydro-Québec DPC",
      description: "Pointe critique\nTarif: DPC\nCritique: Oui\nID: hydroqc_opendata_maison_1",
      start_time: wall(start),
      end_time: wall(end),
    });
  }
  // The living room's thermostat set back, the bedroom's baseboard drawing.
  add(
    "climate.living_room",
    "heat",
    { friendly_name: "Living room", hvac_action: "idle", temperature: 17, current_temperature: 20 },
    { area_id: "living_room" },
  );
  add(
    "sensor.bedroom_baseboard_power",
    "1450",
    { friendly_name: "Bedroom baseboard", device_class: "power", unit_of_measurement: "W" },
    { area_id: "bedroom" },
  );
}
if (sandbox) {
  for (const [id, config] of Object.entries(SANDBOX_SCRIPTS)) {
    home.states[id] = { entity_id: id, state: "off", attributes: { friendly_name: config.alias } };
  }
}
for (const [id, config] of Object.entries(automationConfigs())) {
  home.states[id] = {
    entity_id: id,
    state: "on",
    last_changed: "2026-01-02T08:00:00.000Z",
    attributes: {
      friendly_name: config.alias,
      id: config.id,
      last_triggered: new Date(Date.now() - 3_600_000).toISOString(),
    },
  };
}

/** An automation runs (E2E tests): it is triggered now, and its first action takes effect. */
window.__runAutomation = (id) => {
  const config = automationConfigs()[id];
  const previous = home.states[id];
  if (!config || !previous) return;
  home.states[id] = {
    ...previous,
    attributes: { ...previous.attributes, last_triggered: new Date().toISOString() },
  };
  const first = config.actions[0];
  const [domain, service] = String(first?.action ?? "").split(".");
  if (domain && service) applyService(home, domain, service, first.data ?? {}, first.target ?? {});
  publish();
};
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
  // Its desk lamp, on.
  home.entities["light.office_lamp"] = { entity_id: "light.office_lamp", area_id: "office" };
  home.states["light.office_lamp"] = {
    entity_id: "light.office_lamp",
    state: "on",
    attributes: {
      friendly_name: "Office lamp",
      brightness: 200,
      color_mode: "color_temp",
      color_temp_kelvin: 2700,
      supported_color_modes: ["color_temp"],
    },
  };
  if (store.bindings) {
    store.bindings.elements["up-lamp"] = { entities: [{ entity_id: "light.office_lamp" }] };
  }
}
// Home Assistant's floors (D-055): the apartment on the ground floor, the office above.
home.floors = {
  ground: { floor_id: "ground", name: "Ground floor", level: 0 },
  ...(home.areas.office ? { upper: { floor_id: "upper", name: "Upper floor", level: 1 } } : {}),
};
for (const area of Object.values(home.areas)) {
  area.floor_id = area.area_id === "office" ? "upper" : "ground";
}
if (params.get("wifi") === "image") {
  // A router's own code, as an image entity (FRITZ!Box, UniFi): a picture made here, nothing
  // fetched.
  home.states["image.router_guest_wifi"] = {
    entity_id: "image.router_guest_wifi",
    state: "2026-06-15T08:00:00+00:00",
    attributes: {
      friendly_name: "Router guest Wi-Fi",
      entity_picture:
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#fff"/><rect width="2" height="2" fill="#000"/></svg>',
        ),
    },
  };
}
if (params.get("lists") === "1") {
  home.states["calendar.family"] = {
    entity_id: "calendar.family",
    state: "off",
    attributes: { friendly_name: "Family" },
  };
  home.states["todo.shopping"] = {
    entity_id: "todo.shopping",
    state: "2",
    attributes: { friendly_name: "Shopping" },
  };
}
if (live && why) {
  // A fictional evening (D-059): the states as they are after it, and what the logbook keeps.
  const now = Date.now() / 1000;
  const iso = (seconds) => new Date(seconds * 1000).toISOString();
  const door = now - 300;
  const written = (id, state, when, context, attributes = {}) => {
    const previous = home.states[id];
    home.states[id] = {
      entity_id: id,
      state,
      attributes: { ...(previous?.attributes ?? {}), ...attributes },
      last_changed: iso(when),
      last_updated: iso(when),
      context: { parent_id: null, user_id: null, ...context },
    };
  };
  written("binary_sensor.entrance_door_contact", "on", door, { id: C_DOOR });
  written(
    "automation.hall_light_at_the_door",
    "on",
    door + 0.01,
    {
      id: C_RUN,
      parent_id: C_DOOR,
    },
    {
      friendly_name: "Hall light at the door",
      id: "1004",
      last_triggered: iso(door + 0.01),
    },
  );
  written("light.hall_spots", "on", door + 0.02, { id: C_RUN, parent_id: C_DOOR });
  written("light.living_room_floor_lamp", "on", now - 120, { id: C_SAM, user_id: "user-sam" });
  written("light.kitchen_ceiling", "off", now - 600, { id: C_KITCHEN });
  const source = "state of binary_sensor.entrance_door_contact";
  whyRows = [
    {
      context: C_DOOR,
      when: door,
      entry: { when: door, entity_id: "binary_sensor.entrance_door_contact", state: "on" },
    },
    {
      context: C_RUN,
      when: door + 0.01,
      entry: {
        when: door + 0.01,
        name: "Hall light at the door",
        message: `triggered by ${source}`,
        source,
        entity_id: "automation.hall_light_at_the_door",
        context_id: C_RUN,
        domain: "automation",
      },
    },
    {
      context: C_RUN,
      when: door + 0.02,
      entry: {
        when: door + 0.02,
        entity_id: "light.hall_spots",
        state: "on",
        context_event_type: "automation_triggered",
        context_domain: "automation",
        context_name: "Hall light at the door",
        context_message: `triggered by ${source}`,
        context_source: source,
        context_entity_id: "automation.hall_light_at_the_door",
      },
    },
    {
      context: C_SAM,
      when: now - 120,
      entry: {
        when: now - 120,
        entity_id: "light.living_room_floor_lamp",
        state: "on",
        context_user_id: "user-sam",
        context_event_type: "call_service",
        context_domain: "light",
        context_service: "turn_on",
      },
    },
    {
      context: C_KITCHEN,
      when: now - 600,
      entry: { when: now - 600, entity_id: "light.kitchen_ceiling", state: "off" },
    },
  ];
}
const states = home.states;
// overview=1: what DomoTwin's sensors say of the rooms and the upkeep (D-061), and who is home.
const overview = params.get("overview") === "1";
const state = (entityId, value, attributes) => ({
  entity_id: entityId,
  state: value,
  attributes,
  last_changed: "2026-10-24T08:00:00+00:00",
  last_updated: "2026-10-24T08:00:00+00:00",
});
if (overview) {
  for (const [id, person] of Object.entries(PEOPLE)) {
    states[id] = state(id, person.home ? "home" : "not_home", { friendly_name: person.name });
  }
  const own = (entityId, key) => {
    home.entities[entityId] = { entity_id: entityId, platform: "domotwin", translation_key: key };
  };
  states["sensor.domotwin_kitchen_people"] = state("sensor.domotwin_kitchen_people", "1", {
    room: "Kitchen",
    people: ["person.alex"],
  });
  own("sensor.domotwin_kitchen_people", "room_people");
  states["sensor.domotwin_living_people"] = state("sensor.domotwin_living_people", "0", {
    room: "Living room",
    people: [],
  });
  own("sensor.domotwin_living_people", "room_people");
  states["sensor.domotwin_upkeep_due"] = state("sensor.domotwin_upkeep_due", "2", {
    tasks: [{ piece: "washer", piece_name: "Washer", task: "Clean the filter", state: "overdue" }],
  });
  own("sensor.domotwin_upkeep_due", "upkeep_due");
}
/** A person's room sensor, as the integration writes it, in `room` (or away). */
function roomSensor(id, room) {
  const person = PEOPLE[id];
  const named = demo.rooms.find((r) => r.id === room);
  const sensor = `sensor.domotwin_${id.slice(7)}_room`;
  states[id] = {
    entity_id: id,
    state: room === null ? "not_home" : "home",
    attributes: {
      friendly_name: person.name,
      ...(id === "person.alex" ? { user_id: "e2e" } : {}),
    },
  };
  states[sensor] = {
    entity_id: sensor,
    state: room === null ? "not_home" : (named?.name ?? "unknown"),
    attributes: {
      person: id,
      ...(named
        ? {
            room_id: room,
            area_id: room,
            storey_id: "storey-1",
            storey: "",
            since: new Date(Date.now() - 600_000).toISOString(),
            source: `sensor.${id.slice(7)}_phone_area`,
          }
        : {}),
    },
  };
}
if (peopleParam === "1") {
  for (const [id, person] of Object.entries(PEOPLE)) {
    roomSensor(id, person.home ? person.room : null);
    states[`sensor.${id.slice(7)}_phone_area`] = {
      entity_id: `sensor.${id.slice(7)}_phone_area`,
      state: person.home ? "Kitchen" : "not_home",
      attributes: { friendly_name: `${person.name.split(" ")[0]}'s phone area` },
    };
  }
}
if (bluetoothParam === "1") {
  for (const [id, device] of Object.entries(LOCATED)) {
    const entity_id = `sensor.domotwin_${id}_bluetooth`;
    states[entity_id] = {
      entity_id,
      state: device.roomName,
      attributes: {
        friendly_name: `DomoTwin ${device.name}: room`,
        device_name: device.name,
        kind: device.kind,
        person: device.person,
        left_behind: device.left_behind,
        room_id: device.room,
        area_id: device.room,
      },
    };
    home.entities[entity_id] = { entity_id, platform: "domotwin", translation_key: "located" };
  }
}
if (params.get("radios") === "1") {
  // Where the locating places two of the receivers, and the hall it learned from the living
  // room's (D-066).
  const places = {
    "AA:00:00:00:00:03": { storey: "storey-1", at: [260, 260], z: 120 },
    "BB:00:00:00:00:01": { storey: "storey-1", at: [630, 483.3], z: 120 },
  };
  for (const receiver of store.locating.receivers) receiver.place = places[receiver.source] ?? null;
  store.locating.heard = { hall: { "AA:00:00:00:00:03": { signal: -82, readings: 30 } } };
  // The washing machine's plug reports its Wi-Fi signal (its device is placed at the washer by
  // its power sensor), and so does a display in the kitchen's area.
  const wifi = { device_class: "signal_strength", unit_of_measurement: "dBm" };
  states["sensor.washer_plug_wifi_signal"] = {
    entity_id: "sensor.washer_plug_wifi_signal",
    state: "-77",
    attributes: { ...wifi, friendly_name: "Washer plug WiFi signal" },
  };
  home.entities["sensor.washer_plug_wifi_signal"] = {
    entity_id: "sensor.washer_plug_wifi_signal",
    device_id: "dev-washer-plug",
    platform: "esphome",
    entity_category: "diagnostic",
  };
  home.entities["sensor.washing_machine_power"] = {
    ...home.entities["sensor.washing_machine_power"],
    device_id: "dev-washer-plug",
  };
  home.devices["dev-washer-plug"] = {
    id: "dev-washer-plug",
    area_id: "bathroom",
    name: "Washer plug",
  };
  states["sensor.kitchen_display_rssi"] = {
    entity_id: "sensor.kitchen_display_rssi",
    state: "-49",
    attributes: { ...wifi, friendly_name: "Kitchen display signal" },
  };
  home.entities["sensor.kitchen_display_rssi"] = {
    entity_id: "sensor.kitchen_display_rssi",
    area_id: "kitchen",
    platform: "shelly",
    entity_category: "diagnostic",
  };
  // A Zigbee device's signal: another radio's, never Wi-Fi.
  states["sensor.garden_sensor_rssi"] = {
    entity_id: "sensor.garden_sensor_rssi",
    state: "-70",
    attributes: { ...wifi, friendly_name: "Garden sensor WiFi signal" },
  };
  home.entities["sensor.garden_sensor_rssi"] = {
    entity_id: "sensor.garden_sensor_rssi",
    platform: "zha",
    entity_category: "diagnostic",
  };
  store.settings.access_points = [
    { storey: "storey-1", at: [800, 20], name: "Kitchen access point" },
  ];
}
if (sunParam) {
  const [elevation, rising] = sunParam.split(",");
  states["sun.sun"] = {
    entity_id: "sun.sun",
    state: Number(elevation) > 0 ? "above_horizon" : "below_horizon",
    attributes: { elevation: Number(elevation), rising: rising === "1" },
  };
}
const weatherParam = params.get("weather");
if (weatherParam) {
  states["weather.home"] = {
    entity_id: "weather.home",
    state: weatherParam,
    attributes: {
      friendly_name: "Forecast Home",
      temperature: 9,
      wind_speed: 18,
      wind_speed_unit: "km/h",
      wind_bearing: "SW",
    },
  };
  states["weather.coast"] = {
    entity_id: "weather.coast",
    state: "pouring",
    attributes: { friendly_name: "Forecast Coast", wind_speed: 40, wind_bearing: 270 },
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
  floors: home.floors,
  ...(params.get("firstpage") === "device" ? { defaultPanel: "lovelace" } : {}),
  // 2025.1 has the user's data too; everyone's came with the page kept for each user.
  userData: { showAdvanced: false },
  ...(params.get("firstpage") === "user" ? { systemData: {} } : {}),
  user: { id: "e2e", name: "E2E", is_admin: params.get("admin") !== "0" },
  language,
  locale: { language },
  themes: { darkMode: params.get("dark") === "1" },
  config: {
    components: [
      "domotwin",
      ...(zha ? ["zha"] : []),
      ...(bluetoothParam === "1" ? ["bluetooth"] : []),
      ...(voiceParam ? ["conversation", "assist_pipeline"] : []),
      ...(why ? ["logbook"] : []),
    ],
    // A fictional place, rounded: the sandbox's sun.
    ...(sandbox ? { time_zone: "Europe/Paris", latitude: 46, longitude: 2 } : {}),
    // overview=1: a Home Assistant that opens on its Overview, an area page each (D-061).
    ...(overview ? { version: "2026.10.0" } : { version: "2026.1.0" }),
  },
  ...(overview
    ? {
        panels: {
          home: { url_path: "home" },
          ...(params.get("nopanel") === "1" ? {} : { domotwin: { url_path: "domotwin" } }),
        },
      }
    : {}),
  connection,
  fetchWithAuth,
  // Home Assistant's own words for a state (D-058): `on` as "On", a number with its unit.
  ...(params.get("formatstate") === "1"
    ? {
        formatEntityState(entity, state = entity.state) {
          const unit = entity.attributes.unit_of_measurement;
          if (unit && !Number.isNaN(Number(state))) return `${state} ${unit}`;
          return state.charAt(0).toUpperCase() + state.slice(1);
        },
      }
    : {}),
  callApi,
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
window.__move = (person, room) => {
  roomSensor(person, room);
  publish();
};
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

if (params.get("cards") === "1") {
  // Home Assistant's card helpers (D-055), made up: a card says its type and entity, and a
  // button card runs its scene.
  window.loadCardHelpers = async () => ({
    createCardElement(config) {
      // A custom card is the element it names, as Home Assistant makes it (DomoTwin's summaries).
      if (String(config.type).startsWith("custom:")) {
        const custom = document.createElement(config.type.slice("custom:".length));
        custom.setConfig(config);
        return custom;
      }
      const card = document.createElement("div");
      card.className = "ha-card";
      card.dataset.type = config.type;
      card.dataset.entity = config.entity ?? (config.entities ?? []).join(",");
      card.dataset.config = JSON.stringify(config);
      const draw = (h) => {
        const state = h?.states[config.entity];
        card.textContent = `${config.type} ${state?.attributes.friendly_name ?? config.entity ?? ""} ${state?.state ?? ""}`;
      };
      Object.defineProperty(card, "hass", {
        set(value) {
          card._hass = value;
          draw(value);
        },
        get() {
          return card._hass;
        },
      });
      card.addEventListener("click", () => {
        const [domain] = String(config.entity).split(".");
        if (config.type === "button")
          void card._hass.callService(domain, "turn_on", {}, { entity_id: config.entity });
        else
          card.dispatchEvent(
            new CustomEvent("hass-more-info", {
              detail: { entityId: config.entity },
              bubbles: true,
              composed: true,
            }),
          );
      });
      return card;
    },
  });
}
// The page Home Assistant opens first, on this device (2025.1).
document.addEventListener("hass-default-panel", (event) => {
  calls.push({ type: "hass-default-panel", detail: event.detail });
  hass = { ...hass, defaultPanel: event.detail.defaultPanel };
  if (element) element.hass = hass;
});
document.addEventListener("hass-more-info", (event) => {
  calls.push({ type: "hass-more-info", detail: event.detail });
});

const mount = document.getElementById("mount");
let element;
if (mode === "panel") {
  element = document.createElement("domotwin-panel");
  element.narrow = false;
} else if (mode === "summary") {
  // summary=<kind>: DomoTwin's summary card (D-061).
  mount.classList.add("card");
  element = document.createElement("domotwin-summary-card");
  element.setConfig({ type: "custom:domotwin-summary-card", summary: params.get("summary") });
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
    theme: params.get("theme") ?? undefined,
    names: params.get("names") === "0" ? false : undefined,
    accent: params.get("accent") ?? undefined,
    screen: params.get("screen") ?? undefined,
    idle: params.get("idle") ? Number(params.get("idle")) : undefined,
    tools: params.get("tools") === "0" ? false : undefined,
    orbit: params.get("orbit") === "1" ? true : undefined,
    night_dim: params.get("nightdim") === "1" ? true : undefined,
    voice: params.get("mic") === "0" ? false : undefined,
    font_family: params.get("font") ?? undefined,
    demo: params.get("demo") === "1" ? true : undefined,
    weather: params.get("weatheroption") === "0" ? false : undefined,
  });
}
element.hass = hass;
if (mode === "panel" && params.get("route") === "1") {
  // Home Assistant's address (D-055): the panel's path, and the page's after it.
  history.replaceState(null, "", `/domotwin${params.get("path") ?? ""}${location.search}`);
  const follow = () => {
    // Another page of Home Assistant (an area's in its Overview, D-061): not the panel's.
    if (!location.pathname.startsWith("/domotwin")) return;
    element.route = { prefix: "/domotwin", path: location.pathname.slice("/domotwin".length) };
  };
  follow();
  window.addEventListener("location-changed", follow);
  window.addEventListener("popstate", follow);
}
// What Home Assistant's frontend is asked to do (an action, Assist).
document.addEventListener("hass-action", (event) => {
  calls.push({ type: "hass-action", detail: event.detail });
});
mount.append(element);
window.__element = element;
window.__view = () =>
  element.shadowRoot?.querySelector("domotwin-view") ??
  element.shadowRoot?.querySelector("ha-card domotwin-view");
/** The pixels of a fresh frame of the view, without the overlays (E2E tests). */
window.__framePixels = async () => {
  const image = new Image();
  image.src = window.__view().captureFrame();
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
};
