/**
 * The practical side of the panel (D-055): the Home and Rooms tabs and the user's choices, one
 * chunk loaded the first time one of them shows.
 */
import { addMessages } from "../i18n";
import { practicalEn, practicalFr } from "../i18n/practical";
import "./choices-dialog";
import "./home-tab";
import "./rooms-tab";

addMessages({ en: practicalEn, fr: practicalFr });
