/**
 * The practical side of the panel (D-055): the Home, Rooms and Safety tabs (D-068), the alerts
 * shown above them and the user's choices, one chunk loaded the first time one of them shows.
 */
import { addMessages } from "../i18n";
import { practicalEn, practicalFr } from "../i18n/practical";
import { safetyEn, safetyFr } from "../i18n/safety";
import "./alert-bar";
import "./choices-dialog";
import "./home-tab";
import "./rooms-tab";
import "./safety-tab";

addMessages({ en: practicalEn, fr: practicalFr });
addMessages({ en: safetyEn, fr: safetyFr });
