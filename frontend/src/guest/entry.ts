/**
 * The guests' page (D-067): the module DomoTwin's own page loads, outside Home Assistant's
 * sign-in (`/api/domotwin/guest/<secret>`). It defines the guest's page and the card it shows; the
 * engine and the dialogs are loaded on demand, as in Home Assistant.
 */
import { setAssetBase } from "../assets";
import { DomoTwinCard } from "../components/card";
import { define } from "../components/define";
import { DomoTwinView } from "../components/view";
import { declareBundledFont } from "../fonts";
import { DomoTwinGuest } from "./page";

setAssetBase(new URL(".", import.meta.url));
declareBundledFont();

define("domotwin-view", DomoTwinView);
define("domotwin-card", DomoTwinCard);
define("domotwin-guest", DomoTwinGuest);
