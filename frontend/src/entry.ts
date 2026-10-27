/**
 * The module Home Assistant loads on every page (`add_extra_js_url`) and for the sidebar panel.
 * It only defines the custom elements; the engine and the card editor are loaded on demand.
 */
import { setAssetBase } from "./assets";
import { DomoTwinCard } from "./components/card";
import { define } from "./components/define";
import { DomoTwinPanel } from "./components/panel";
import { DomoTwinSummaryCard } from "./components/summary-card";
import { DomoTwinView } from "./components/view";
import { declareBundledFont } from "./fonts";
import { Translator, loadLanguage } from "./i18n";

setAssetBase(new URL(".", import.meta.url));
declareBundledFont();

define("domotwin-view", DomoTwinView);
define("domotwin-card", DomoTwinCard);
define("domotwin-panel", DomoTwinPanel);
define("domotwin-summary-card", DomoTwinSummaryCard);

const cards = (window.customCards ??= []);
const t = new Translator(document.documentElement.lang || navigator.language);
const card = {
  type: "domotwin-card",
  name: t.t("card.name"),
  description: t.t("card.description"),
  preview: false,
  documentationURL: "https://github.com/arthur-leguennec/ha-domotwin",
};
// DomoTwin's summaries, in the manner of Home Assistant's Overview (D-061).
const summary = {
  type: "domotwin-summary-card",
  name: t.t("summary.name"),
  description: t.t("summary.description"),
  preview: true,
  documentationURL: "https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/overview.md",
};
if (!cards.some((known) => known.type === card.type)) cards.push(card);
if (!cards.some((known) => known.type === summary.type)) cards.push(summary);
// In English until the language's messages are here (D-081), then in it.
void loadLanguage(t.language).then(() => {
  card.name = t.t("card.name");
  card.description = t.t("card.description");
  summary.name = t.t("summary.name");
  summary.description = t.t("summary.description");
});

console.info(`DomoTwin ${__DOMOTWIN_VERSION__}`);
