/**
 * The practical side of the panel (D-055): the Home, Rooms and Safety tabs (D-068), the alerts
 * shown above them, the user's choices and their shortcuts (D-084), one chunk loaded the first
 * time one of them shows; the shortcuts' dialog is its own, loaded when first opened.
 */
import { addMessages } from "../i18n";
import { practicalEn, practicalFr } from "../i18n/practical";
import { safetyEn, safetyFr } from "../i18n/safety";
import { shortcutsEn, shortcutsFr } from "../i18n/shortcuts";
import "./alert-bar";
import "./choices-dialog";
import "./home-tab";
import "./rooms-tab";
import "./safety-tab";

addMessages({ en: practicalEn, fr: practicalFr });
addMessages({ en: safetyEn, fr: safetyFr });
addMessages({ en: shortcutsEn, fr: shortcutsFr });
