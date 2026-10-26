/**
 * The words of a "Why?" chain (D-058): each step as the device's sheet lists it and as the chain
 * drawn in 3D labels it. Adds the messages of "Why?" the first time one of its chunks loads.
 */
import type { HomeAssistant } from "../ha/types";
import { addMessages, type Translator } from "../i18n";
import { whyEn, whyFr } from "../i18n/why";
import { entityName } from "../live/bindings";
import type { WhyStep } from "../live/why";

addMessages({ en: whyEn, fr: whyFr });

/** A step in words: what it is, and what kind of cause it is. */
export interface StepWords {
  main: string;
  detail: string;
}

/** The words of a step; `users` names the users of the chain, and what the viewer may not see
 * (D-039) is said to be in a private room. */
export function stepWords(
  t: Translator,
  hass: HomeAssistant,
  step: WhyStep,
  users: ReadonlyMap<string, string>,
  unseen?: (entity: string) => boolean,
): StepWords {
  const name = (id: string | undefined): string => (id ? entityName(hass, id) : "");
  switch (step.kind) {
    case "person":
      return {
        main: (step.user && users.get(step.user)) ?? t.t("why.someone"),
        detail: step.service ? t.t("why.asked_with", { service: step.service }) : t.t("why.asked"),
      };
    case "change":
      if (step.entity && unseen?.(step.entity)) {
        return { main: t.t("people.in_private_room"), detail: t.t("why.changed") };
      }
      return {
        main:
          step.state !== undefined
            ? t.t("why.state", { name: name(step.entity), state: step.state })
            : name(step.entity),
        detail: t.t("why.changed"),
      };
    case "automation":
      return { main: name(step.entity), detail: t.t("why.automation") };
    case "script":
      return { main: name(step.entity), detail: t.t("why.script") };
    case "action":
      return { main: step.service ?? "", detail: t.t("why.action") };
    case "time":
      return { main: t.t("why.time"), detail: t.t("why.time_detail") };
    case "sun":
      return {
        main:
          step.text === "sunrise" || step.text === "sunset"
            ? t.t(`why.${step.text}`)
            : t.t("why.sun", { event: step.text ?? "" }),
        detail: t.t("why.time_detail"),
      };
    case "start":
      return {
        main: t.t(step.text === "stopping" ? "why.stopping" : "why.starting"),
        detail: t.t("why.time_detail"),
      };
    case "event":
      return { main: t.t("why.event", { type: step.text ?? "" }), detail: t.t("why.time_detail") };
    case "trigger":
      return { main: step.text ?? "", detail: t.t("why.trigger_detail") };
    case "integration":
      return {
        main: step.text ?? "",
        detail: step.service
          ? t.t("why.integration_detail", { domain: step.service })
          : t.t("why.integration"),
      };
    case "unattributed":
      return { main: t.t("why.unattributed"), detail: t.t("why.unattributed_detail") };
    case "lost":
      return { main: t.t("why.lost"), detail: t.t("why.lost_detail") };
  }
}
