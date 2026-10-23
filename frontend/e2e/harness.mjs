// A mocked Home Assistant around the real built frontend. Query parameters:
//   mode=card|panel  lang=en|fr  plan=demo|none  admin=1|0  dark=1
const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "card";

await import("/domotwin_static/domotwin.js?v=e2e");

const demo = await (await fetch("/examples/demo-apartment.plan.json")).json();
const store = {
  plan: params.get("plan") === "none" ? null : demo,
  layout: {},
  bindings: { version: 1, rooms: {}, elements: {} },
  revision: 1,
};
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
const hass = {
  states: {},
  user: { id: "e2e", name: "E2E", is_admin: params.get("admin") !== "0" },
  language,
  locale: { language },
  themes: { darkMode: params.get("dark") === "1" },
  connection,
  async callService(domain, service, data, target) {
    calls.push({ type: "call_service", domain, service, data, target });
  },
};
window.__hass = hass;
if (hass.themes.darkMode) document.body.classList.add("dark");

const mount = document.getElementById("mount");
let element;
if (mode === "panel") {
  element = document.createElement("domotwin-panel");
  element.narrow = false;
} else {
  mount.classList.add("card");
  element = document.createElement("domotwin-card");
  element.setConfig({ type: "custom:domotwin-card", title: params.get("title") ?? undefined });
}
element.hass = hass;
mount.append(element);
window.__element = element;
window.__view = () =>
  element.shadowRoot?.querySelector("domotwin-view") ??
  element.shadowRoot?.querySelector("ha-card domotwin-view");
