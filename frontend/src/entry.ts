/**
 * The module Home Assistant loads on every page (`add_extra_js_url`) and for the sidebar panel.
 * It only defines the custom elements; the engine and the card editor are loaded on demand.
 */
import { setAssetBase } from "./assets";
import { DomoTwinCard } from "./components/card";
import { define } from "./components/define";
import { DomoTwinPanel } from "./components/panel";
import { DomoTwinView } from "./components/view";
import { Translator } from "./i18n";

setAssetBase(new URL(".", import.meta.url));

define("domotwin-view", DomoTwinView);
define("domotwin-card", DomoTwinCard);
define("domotwin-panel", DomoTwinPanel);

const cards = (window.customCards ??= []);
if (!cards.some((card) => card.type === "domotwin-card")) {
  const t = new Translator(document.documentElement.lang || navigator.language);
  cards.push({
    type: "domotwin-card",
    name: t.t("card.name"),
    description: t.t("card.description"),
    preview: false,
    documentationURL: "https://github.com/arthur-leguennec/ha-domotwin",
  });
}

console.info(`DomoTwin ${__DOMOTWIN_VERSION__}`);
