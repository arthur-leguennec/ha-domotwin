/**
 * `<domotwin-saver>`: a wall screen's screen saver (D-076), over every tab: the time and the day,
 * the weather, and the photos of a folder of Home Assistant's media one after another, slowly
 * cross-faded; at night the clock alone, dimmed. The clock moves a little every minute, so that no
 * pixel stays lit the same for hours. A tap or a key wakes the screen (the panel also wakes it when
 * someone moves); a chunk loaded the first time it comes.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { nowOf, type HomeAssistant } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { practicalEn, practicalFr } from "../i18n/practical";
import { wallEn, wallFr } from "../i18n/wall";
import { timeStyle } from "../live/schedules";
import { browseMedia, resolveMedia, shuffled, type MediaItem } from "../live/media";
import { NO_SAVER, isNight, type SaverLayout } from "../live/screens";
import { conditionWords, weatherShown, type WeatherChoice } from "../live/weather";
import { define, fire } from "./define";
import { icon } from "./icon";

addMessages({ en: wallEn, fr: wallFr });
// The weather's conditions, as the Home tab says them.
addMessages({ en: practicalEn, fr: practicalFr });

/**
 * Home Assistant's weather conditions and their pictures: Material Design Icons' (Apache 2.0, as
 * `@mdi/js` gives them), written here so that they come with the saver, not with the first load
 * (whose chunk keeps every icon taken from `@mdi/js`).
 */
const CONDITIONS: Record<string, string> = {
  "clear-night":
    "M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.64 6.35,17.66C9.37,20.67 14.19,20.78 17.33,17.97Z",
  cloudy:
    "M6,19A5,5 0 0,1 1,14A5,5 0 0,1 6,9C7,6.65 9.3,5 12,5C15.43,5 18.24,7.66 18.5,11.03L19,11A4,4 0 0,1 23,15A4,4 0 0,1 19,19H6M19,13H17V12A5,5 0 0,0 12,7C9.5,7 7.45,8.82 7.06,11.19C6.73,11.07 6.37,11 6,11A3,3 0 0,0 3,14A3,3 0 0,0 6,17H19A2,2 0 0,0 21,15A2,2 0 0,0 19,13Z",
  exceptional:
    "M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z",
  fog: "M3,15H13A1,1 0 0,1 14,16A1,1 0 0,1 13,17H3A1,1 0 0,1 2,16A1,1 0 0,1 3,15M16,15H21A1,1 0 0,1 22,16A1,1 0 0,1 21,17H16A1,1 0 0,1 15,16A1,1 0 0,1 16,15M1,12A5,5 0 0,1 6,7C7,4.65 9.3,3 12,3C15.43,3 18.24,5.66 18.5,9.03L19,9C21.19,9 22.97,10.76 23,13H21A2,2 0 0,0 19,11H17V10A5,5 0 0,0 12,5C9.5,5 7.45,6.82 7.06,9.19C6.73,9.07 6.37,9 6,9A3,3 0 0,0 3,12C3,12.35 3.06,12.69 3.17,13H1.1L1,12M3,19H5A1,1 0 0,1 6,20A1,1 0 0,1 5,21H3A1,1 0 0,1 2,20A1,1 0 0,1 3,19M8,19H21A1,1 0 0,1 22,20A1,1 0 0,1 21,21H8A1,1 0 0,1 7,20A1,1 0 0,1 8,19Z",
  hail: "M6,14A1,1 0 0,1 7,15A1,1 0 0,1 6,16A5,5 0 0,1 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16H18A1,1 0 0,1 17,15A1,1 0 0,1 18,14H19A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11A3,3 0 0,0 6,14M10,18A2,2 0 0,1 12,20A2,2 0 0,1 10,22A2,2 0 0,1 8,20A2,2 0 0,1 10,18M14.5,16A1.5,1.5 0 0,1 16,17.5A1.5,1.5 0 0,1 14.5,19A1.5,1.5 0 0,1 13,17.5A1.5,1.5 0 0,1 14.5,16M10.5,12A1.5,1.5 0 0,1 12,13.5A1.5,1.5 0 0,1 10.5,15A1.5,1.5 0 0,1 9,13.5A1.5,1.5 0 0,1 10.5,12Z",
  lightning:
    "M6,16A5,5 0 0,1 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16H18A1,1 0 0,1 17,15A1,1 0 0,1 18,14H19A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11A3,3 0 0,0 6,14H7A1,1 0 0,1 8,15A1,1 0 0,1 7,16H6M12,11H15L13,15H15L11.25,22L12,17H9.5L12,11Z",
  "lightning-rainy":
    "M4.5,13.59C5,13.87 5.14,14.5 4.87,14.96C4.59,15.44 4,15.6 3.5,15.33V15.33C2,14.47 1,12.85 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16A1,1 0 0,1 18,15A1,1 0 0,1 19,14A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11C3,12.11 3.6,13.08 4.5,13.6V13.59M9.5,11H12.5L10.5,15H12.5L8.75,22L9.5,17H7L9.5,11M17.5,18.67C17.5,19.96 16.5,21 15.25,21C14,21 13,19.96 13,18.67C13,17.12 15.25,14.5 15.25,14.5C15.25,14.5 17.5,17.12 17.5,18.67Z",
  partlycloudy:
    "M12.74,5.47C15.1,6.5 16.35,9.03 15.92,11.46C17.19,12.56 18,14.19 18,16V16.17C18.31,16.06 18.65,16 19,16A3,3 0 0,1 22,19A3,3 0 0,1 19,22H6A4,4 0 0,1 2,18A4,4 0 0,1 6,14H6.27C5,12.45 4.6,10.24 5.5,8.26C6.72,5.5 9.97,4.24 12.74,5.47M11.93,7.3C10.16,6.5 8.09,7.31 7.31,9.07C6.85,10.09 6.93,11.22 7.41,12.13C8.5,10.83 10.16,10 12,10C12.7,10 13.38,10.12 14,10.34C13.94,9.06 13.18,7.86 11.93,7.3M13.55,3.64C13,3.4 12.45,3.23 11.88,3.12L14.37,1.82L15.27,4.71C14.76,4.29 14.19,3.93 13.55,3.64M6.09,4.44C5.6,4.79 5.17,5.19 4.8,5.63L4.91,2.82L7.87,3.5C7.25,3.71 6.65,4.03 6.09,4.44M18,9.71C17.91,9.12 17.78,8.55 17.59,8L19.97,9.5L17.92,11.73C18.03,11.08 18.05,10.4 18,9.71M3.04,11.3C3.11,11.9 3.24,12.47 3.43,13L1.06,11.5L3.1,9.28C3,9.93 2.97,10.61 3.04,11.3M19,18H16V16A4,4 0 0,0 12,12A4,4 0 0,0 8,16H6A2,2 0 0,0 4,18A2,2 0 0,0 6,20H19A1,1 0 0,0 20,19A1,1 0 0,0 19,18Z",
  pouring:
    "M9,12C9.53,12.14 9.85,12.69 9.71,13.22L8.41,18.05C8.27,18.59 7.72,18.9 7.19,18.76C6.65,18.62 6.34,18.07 6.5,17.54L7.78,12.71C7.92,12.17 8.47,11.86 9,12M13,12C13.53,12.14 13.85,12.69 13.71,13.22L11.64,20.95C11.5,21.5 10.95,21.8 10.41,21.66C9.88,21.5 9.56,20.97 9.7,20.43L11.78,12.71C11.92,12.17 12.47,11.86 13,12M17,12C17.53,12.14 17.85,12.69 17.71,13.22L16.41,18.05C16.27,18.59 15.72,18.9 15.19,18.76C14.65,18.62 14.34,18.07 14.5,17.54L15.78,12.71C15.92,12.17 16.47,11.86 17,12M17,10V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11C3,12.11 3.6,13.08 4.5,13.6V13.59C5,13.87 5.14,14.5 4.87,14.96C4.59,15.43 4,15.6 3.5,15.32V15.33C2,14.47 1,12.85 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12C23,13.5 22.2,14.77 21,15.46V15.46C20.5,15.73 19.91,15.57 19.63,15.09C19.36,14.61 19.5,14 20,13.72V13.73C20.6,13.39 21,12.74 21,12A2,2 0 0,0 19,10H17Z",
  rainy:
    "M6,14.03A1,1 0 0,1 7,15.03C7,15.58 6.55,16.03 6,16.03C3.24,16.03 1,13.79 1,11.03C1,8.27 3.24,6.03 6,6.03C7,3.68 9.3,2.03 12,2.03C15.43,2.03 18.24,4.69 18.5,8.06L19,8.03A4,4 0 0,1 23,12.03C23,14.23 21.21,16.03 19,16.03H18C17.45,16.03 17,15.58 17,15.03C17,14.47 17.45,14.03 18,14.03H19A2,2 0 0,0 21,12.03A2,2 0 0,0 19,10.03H17V9.03C17,6.27 14.76,4.03 12,4.03C9.5,4.03 7.45,5.84 7.06,8.21C6.73,8.09 6.37,8.03 6,8.03A3,3 0 0,0 3,11.03A3,3 0 0,0 6,14.03M12,14.15C12.18,14.39 12.37,14.66 12.56,14.94C13,15.56 14,17.03 14,18C14,19.11 13.1,20 12,20A2,2 0 0,1 10,18C10,17.03 11,15.56 11.44,14.94C11.63,14.66 11.82,14.4 12,14.15M12,11.03L11.5,11.59C11.5,11.59 10.65,12.55 9.79,13.81C8.93,15.06 8,16.56 8,18A4,4 0 0,0 12,22A4,4 0 0,0 16,18C16,16.56 15.07,15.06 14.21,13.81C13.35,12.55 12.5,11.59 12.5,11.59",
  snowy:
    "M6,14A1,1 0 0,1 7,15A1,1 0 0,1 6,16A5,5 0 0,1 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16H18A1,1 0 0,1 17,15A1,1 0 0,1 18,14H19A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11A3,3 0 0,0 6,14M7.88,18.07L10.07,17.5L8.46,15.88C8.07,15.5 8.07,14.86 8.46,14.46C8.85,14.07 9.5,14.07 9.88,14.46L11.5,16.07L12.07,13.88C12.21,13.34 12.76,13.03 13.29,13.17C13.83,13.31 14.14,13.86 14,14.4L13.41,16.59L15.6,16C16.14,15.86 16.69,16.17 16.83,16.71C16.97,17.24 16.66,17.79 16.12,17.93L13.93,18.5L15.54,20.12C15.93,20.5 15.93,21.15 15.54,21.54C15.15,21.93 14.5,21.93 14.12,21.54L12.5,19.93L11.93,22.12C11.79,22.66 11.24,22.97 10.71,22.83C10.17,22.69 9.86,22.14 10,21.6L10.59,19.41L8.4,20C7.86,20.14 7.31,19.83 7.17,19.29C7.03,18.76 7.34,18.21 7.88,18.07Z",
  "snowy-rainy":
    "M18.5,18.67C18.5,19.96 17.5,21 16.25,21C15,21 14,19.96 14,18.67C14,17.12 16.25,14.5 16.25,14.5C16.25,14.5 18.5,17.12 18.5,18.67M4,17.36C3.86,16.82 4.18,16.25 4.73,16.11L7,15.5L5.33,13.86C4.93,13.46 4.93,12.81 5.33,12.4C5.73,12 6.4,12 6.79,12.4L8.45,14.05L9.04,11.8C9.18,11.24 9.75,10.92 10.29,11.07C10.85,11.21 11.17,11.78 11,12.33L10.42,14.58L12.67,14C13.22,13.83 13.79,14.15 13.93,14.71C14.08,15.25 13.76,15.82 13.2,15.96L10.95,16.55L12.6,18.21C13,18.6 13,19.27 12.6,19.67C12.2,20.07 11.54,20.07 11.15,19.67L9.5,18L8.89,20.27C8.75,20.83 8.18,21.14 7.64,21C7.08,20.86 6.77,20.29 6.91,19.74L7.5,17.5L5.26,18.09C4.71,18.23 4.14,17.92 4,17.36M1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16A1,1 0 0,1 18,15A1,1 0 0,1 19,14A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11C3,11.85 3.35,12.61 3.91,13.16C4.27,13.55 4.26,14.16 3.88,14.54C3.5,14.93 2.85,14.93 2.47,14.54C1.56,13.63 1,12.38 1,11Z",
  sunny:
    "M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,2L14.39,5.42C13.65,5.15 12.84,5 12,5C11.16,5 10.35,5.15 9.61,5.42L12,2M3.34,7L7.5,6.65C6.9,7.16 6.36,7.78 5.94,8.5C5.5,9.24 5.25,10 5.11,10.79L3.34,7M3.36,17L5.12,13.23C5.26,14 5.53,14.78 5.95,15.5C6.37,16.24 6.91,16.86 7.5,17.37L3.36,17M20.65,7L18.88,10.79C18.74,10 18.47,9.23 18.05,8.5C17.63,7.78 17.1,7.15 16.5,6.64L20.65,7M20.64,17L16.5,17.36C17.09,16.85 17.62,16.22 18.04,15.5C18.46,14.77 18.73,14 18.87,13.21L20.64,17M12,22L9.59,18.56C10.33,18.83 11.14,19 12,19C12.82,19 13.63,18.83 14.37,18.56L12,22Z",
  windy:
    "M4,10A1,1 0 0,1 3,9A1,1 0 0,1 4,8H12A2,2 0 0,0 14,6A2,2 0 0,0 12,4C11.45,4 10.95,4.22 10.59,4.59C10.2,5 9.56,5 9.17,4.59C8.78,4.2 8.78,3.56 9.17,3.17C9.9,2.45 10.9,2 12,2A4,4 0 0,1 16,6A4,4 0 0,1 12,10H4M19,12A1,1 0 0,0 20,11A1,1 0 0,0 19,10C18.72,10 18.47,10.11 18.29,10.29C17.9,10.68 17.27,10.68 16.88,10.29C16.5,9.9 16.5,9.27 16.88,8.88C17.42,8.34 18.17,8 19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14H5A1,1 0 0,1 4,13A1,1 0 0,1 5,12H19M18,18H4A1,1 0 0,1 3,17A1,1 0 0,1 4,16H18A3,3 0 0,1 21,19A3,3 0 0,1 18,22C17.17,22 16.42,21.66 15.88,21.12C15.5,20.73 15.5,20.1 15.88,19.71C16.27,19.32 16.9,19.32 17.29,19.71C17.47,19.89 17.72,20 18,20A1,1 0 0,0 19,19A1,1 0 0,0 18,18Z",
  "windy-variant":
    "M6,6L6.69,6.06C7.32,3.72 9.46,2 12,2A5.5,5.5 0 0,1 17.5,7.5L17.42,8.45C17.88,8.16 18.42,8 19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14H6A4,4 0 0,1 2,10A4,4 0 0,1 6,6M6,8A2,2 0 0,0 4,10A2,2 0 0,0 6,12H19A1,1 0 0,0 20,11A1,1 0 0,0 19,10H15.5V7.5A3.5,3.5 0 0,0 12,4A3.5,3.5 0 0,0 8.5,7.5V8H6M18,18H4A1,1 0 0,1 3,17A1,1 0 0,1 4,16H18A3,3 0 0,1 21,19A3,3 0 0,1 18,22C17.17,22 16.42,21.66 15.88,21.12C15.5,20.73 15.5,20.1 15.88,19.71C16.27,19.32 16.9,19.32 17.29,19.71C17.47,19.89 17.72,20 18,20A1,1 0 0,0 19,19A1,1 0 0,0 18,18Z",
};

/** How often the clock is drawn again (ms): a minute is never shown late by more than this. */
const TICK_MS = 5_000;
/** How long before a folder without photos is looked into again (ms). */
const EMPTY_FOLDER_MS = 5 * 60_000;

/** The formats of the clock, the date and the temperature, made once for each way of writing. */
const FORMATS = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function dateFormat(
  kind: "time" | "date",
  language: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const id = `${kind}|${language}|${options.timeZone ?? ""}|${String(options.hour12)}`;
  let format = FORMATS.get(id) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(language, options);
    FORMATS.set(id, format);
  }
  return format;
}

function degreesFormat(language: string): Intl.NumberFormat {
  const id = `degrees|${language}`;
  let format = FORMATS.get(id) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
    FORMATS.set(id, format);
  }
  return format;
}

/** A photo ready to show: its address, fetched and decoded already. */
async function loaded(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/**
 * Where the clock stands this minute (px): a few pixels around its place, another each minute
 * and back after a while, so that a screen left on for days does not keep its marks.
 */
export function drift(minute: number): { x: number; y: number } {
  return { x: (((minute * 7) % 9) - 4) * 3, y: (((minute * 5) % 9) - 4) * 3 };
}

export class DomoTwinSaver extends LitElement {
  static override properties = {
    hass: { attribute: false },
    t: { attribute: false },
    saver: { attribute: false },
    weather: { attribute: false },
    now: { state: true },
    photos: { state: true },
    front: { state: true },
  };

  hass?: HomeAssistant;
  t?: Translator;
  saver: SaverLayout = NO_SAVER;
  /** The weather drawn around the home, as the settings chose it (D-072). */
  weather?: WeatherChoice;
  protected now = Date.now();
  /** The two photos cross-faded: the one shown (`front`) and the one before or next. */
  protected photos: [string | undefined, string | undefined] = [undefined, undefined];
  protected front = 0;
  private items: MediaItem[] = [];
  private next = 0;
  private clock?: number;
  private photoTimer?: number;
  /** Bumped when the folder changes or the saver goes: answers still coming are dropped. */
  private round = 0;

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      /* Under a doorbell ringing (10), over everything else. */
      z-index: 9;
      display: block;
      overflow: hidden;
      background: #000;
      color: #fff;
      cursor: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .saver {
      position: absolute;
      inset: 0;
    }
    .saver:focus {
      outline: none;
    }
    /* A photo comes closer slowly while shown, and goes back as slowly once the next shows: it
       never jumps, whichever way it goes. */
    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transform: scale(1);
      transition:
        opacity 2s ease,
        transform var(--domotwin-photo-seconds, 30s) linear;
    }
    img.shown {
      opacity: 1;
      transform: scale(1.08);
    }
    .shade {
      position: absolute;
      inset: auto 0 0 0;
      height: 50%;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
    }
    .corner {
      position: absolute;
      inset-inline-start: max(4vmin, 24px);
      bottom: max(4vmin, 24px);
      display: grid;
      gap: 4px;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
      transition: transform 2s ease;
    }
    .time {
      font-size: clamp(56px, 16vmin, 220px);
      font-weight: 200;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .date {
      font-size: clamp(18px, 3.4vmin, 40px);
      font-weight: 300;
    }
    .weather {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
      font-size: clamp(18px, 3.4vmin, 40px);
      font-weight: 300;
    }
    .weather svg.icon {
      width: 1.6em;
      height: 1.6em;
      fill: currentColor;
    }
    .night .corner {
      opacity: 0.45;
    }
    .night .weather {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      img,
      .corner {
        transition: none;
      }
      img.shown {
        transform: none;
      }
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    this.now = nowOf(this.hass);
    this.clock = window.setInterval(() => {
      this.now = nowOf(this.hass);
    }, TICK_MS);
    void this.startPhotos();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearInterval(this.clock);
    window.clearTimeout(this.photoTimer);
    this.round += 1;
  }

  protected override updated(changed: PropertyValues<this>): void {
    const before = changed.get("saver");
    if (before && before.photos !== this.saver.photos) void this.startPhotos();
  }

  /**
   * The photos of the saver's folder, in another order each time they all were shown. The photo
   * shown stays until the next is ready (`again`: the same folder read again), unless the folder
   * changed.
   */
  private async startPhotos(again = false): Promise<void> {
    window.clearTimeout(this.photoTimer);
    const round = ++this.round;
    this.items = [];
    this.next = 0;
    if (!again) this.photos = [undefined, undefined];
    const hass = this.hass;
    const folder = this.saver.photos;
    if (!hass || !folder) return;
    try {
      const read = await browseMedia(hass, folder);
      if (round !== this.round) return;
      this.items = shuffled(read.photos);
    } catch {
      // Gone meanwhile (the screen woken): nothing more.
      if (round !== this.round) return;
      // The folder gone, or Home Assistant's media not set up: the clock alone, until later.
      this.photoTimer = window.setTimeout(() => void this.startPhotos(true), EMPTY_FOLDER_MS);
      return;
    }
    if (this.items.length === 0) {
      // No photo yet: looked into again later, for those added meanwhile.
      this.photoTimer = window.setTimeout(() => void this.startPhotos(true), EMPTY_FOLDER_MS);
      return;
    }
    await this.showNext(round);
  }

  /** The next photo, once fetched, cross-faded over the one shown; then the one after, later. */
  private async showNext(round: number): Promise<void> {
    const hass = this.hass;
    if (!hass || round !== this.round) return;
    const night = this.saver.dim && isNight(hass);
    const item = night ? undefined : this.items[this.next];
    if (item) {
      this.next += 1;
      try {
        const url = await resolveMedia(hass, item.id);
        await loaded(url);
        if (round !== this.round) return;
        const back = this.front === 0 ? 1 : 0;
        const photos: [string | undefined, string | undefined] = [...this.photos];
        photos[back] = url;
        this.photos = photos;
        this.front = back;
      } catch {
        // That photo could not be read: the next one, at its time.
      }
    }
    if (round !== this.round) return;
    if (this.next >= this.items.length) {
      // All were shown: the folder read again (photos added meanwhile), in another order.
      this.photoTimer = window.setTimeout(
        () => void this.startPhotos(true),
        this.saver.every * 1000,
      );
      return;
    }
    this.photoTimer = window.setTimeout(() => void this.showNext(round), this.saver.every * 1000);
  }

  private renderWeather(hass: HomeAssistant, t: Translator): TemplateResult | typeof nothing {
    if (!this.saver.weather) return nothing;
    // No weather drawn around the home (D-072) is not no weather on the wall: the usual one.
    const shown = weatherShown(hass, this.weather === "none" ? undefined : this.weather);
    if (!shown) return nothing;
    const attributes = hass.states[shown.entity]?.attributes ?? {};
    const temperature = attributes.temperature;
    const unit = typeof attributes.temperature_unit === "string" ? attributes.temperature_unit : "";
    const degrees =
      typeof temperature === "number" && Number.isFinite(temperature)
        ? `${degreesFormat(hass.locale?.language ?? hass.language).format(temperature)}${
            unit ? ` ${unit}` : ""
          }`
        : "";
    const picture = CONDITIONS[shown.condition];
    const words = conditionWords(t, shown.condition);
    return html`<div class="weather" data-testid="saver-weather">
      ${picture ? icon(picture) : nothing} ${degrees ? html`<span>${degrees}</span>` : nothing}<span
        >${words}</span
      >
    </div>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const t = this.t;
    if (!hass || !t) return nothing;
    const style = timeStyle(hass);
    const at = new Date(this.now);
    const time = dateFormat("time", style.language, {
      timeZone: style.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: style.hour12,
    }).format(at);
    const date = dateFormat("date", style.language, {
      timeZone: style.timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(at);
    const night = this.saver.dim && isNight(hass);
    const { x, y } = drift(Math.floor(this.now / 60_000));
    return html`<div
      class="saver ${night ? "night" : ""}"
      role="button"
      tabindex="0"
      aria-label=${t.t("wall.saver")}
      data-testid="saver"
      style="--domotwin-photo-seconds: ${this.saver.every + 2}s"
      @click=${() => {
        fire(this, "domotwin-wake", undefined);
      }}
    >
      ${
        night
          ? nothing
          : this.photos.map((url, i) =>
              url
                ? html`<img
                    class=${i === this.front ? "shown" : ""}
                    src=${url}
                    alt=""
                    data-testid=${i === this.front ? "saver-photo" : nothing}
                  />`
                : nothing,
            )
      }
      <div class="shade"></div>
      <div class="corner" style="transform: translate(${x}px, ${y}px)">
        <div class="time" data-testid="saver-time">${time}</div>
        <div class="date">${date}</div>
        ${this.renderWeather(hass, t)}
      </div>
    </div>`;
  }
}

define("domotwin-saver", DomoTwinSaver);

declare global {
  interface HTMLElementTagNameMap {
    "domotwin-saver": DomoTwinSaver;
  }
}
