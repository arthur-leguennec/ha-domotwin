"""What DomoTwin offers the voice assistants (`docs/DECISIONS.md`, D-046).

Home Assistant hands an LLM conversation agent that controls the home ("Assist") the tools of the
integrations loaded. DomoTwin's switch devices later, say what is set and cancel it, so that
"switch the lantern on tomorrow at 6:30 until 6:45" works with nothing to install. Only the
entities exposed to the assistant can be named.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, override

from homeassistant.components.homeassistant import async_should_expose
from homeassistant.components.llm import LLMTools
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv, intent
from homeassistant.helpers.llm import (
    LLM_API_ASSIST,
    LLMContext,
    Tool,
    ToolAnnotations,
    ToolInput,
    ToolResult,
)

from .compat import vol
from .const import DOMAIN, MAX_SCHEDULE_ENTITIES, SCHEDULABLE_DOMAINS
from .data import SCHEDULER_KEY
from .rights import HIDDEN, Levels, levels_for
from .schedules import Scheduled, ScheduleError, Scheduler, describe, moment, times

PROMPT = (
    "To switch a device on or off later (at a time, after a while, or for a while), use "
    "domotwin__schedule: DomoTwin keeps it, even if Home Assistant restarts."
)

#: What the assistant is told when an action is refused.
REASONS = {
    "no_match": "No device exposed to you has that name (in that area).",
    "ambiguous": "Several devices have that name: give the area.",
    "no_start": "Say when: start, or in_minutes.",
    "bad_time": "A time could not be read: give a local date and time, YYYY-MM-DDTHH:MM:SS.",
    "too_many_entities": f"At most {MAX_SCHEDULE_ENTITIES} devices at once.",
    "unknown_entity": "One of the devices does not exist.",
    "not_schedulable": "Only lights, switches, fans, media players, climate and covers.",
    "in_the_past": "That time has passed.",
    "too_far": "At most a year ahead.",
    "off_with_end": "An end or a brightness goes with turn_on.",
    "end_before_start": "The end comes before the start.",
    "too_long": "A device is left on a week at most.",
    "too_many": "100 actions are waiting already: cancel some first.",
    "not_allowed": "The user may not control that device.",
    "not_loaded": "DomoTwin is not set up.",
}


def _user(llm_context: LLMContext) -> str | None:
    """Who speaks to the assistant, when Home Assistant knows."""
    return llm_context.context.user_id if llm_context.context is not None else None


TARGET = {
    vol.Required("name", description="The device's name or alias, as the user says it."): cv.string,
    vol.Optional("area", description="Its area, when several devices have that name."): cv.string,
}


async def _levels(hass: HomeAssistant, llm_context: LLMContext) -> Levels | None:
    """The levels of entities for who speaks: their rights, everyone's for nobody's (D-070)."""
    user_id = _user(llm_context)
    user = await hass.auth.async_get_user(user_id) if user_id else None
    return levels_for(hass, user, voice=True)


def _refused(code: str) -> ToolResult:
    return ToolResult(data={"error": code, "reason": REASONS.get(code, code)}, error=True)


def _targets(
    hass: HomeAssistant, llm_context: LLMContext, name: str, area: str | None
) -> list[str] | str:
    """The entities exposed to the assistant that the user names, or why there are none."""
    exposed = hass.states.get(name) if cv.valid_entity_id(name) else None
    if exposed is not None and async_should_expose(hass, llm_context.assistant, name):
        return [name]
    result = intent.async_match_targets(
        hass,
        intent.MatchTargetsConstraints(
            name=name,
            area_name=area,
            domains=SCHEDULABLE_DOMAINS,
            assistant=llm_context.assistant,
        ),
    )
    if not result.is_match:
        duplicate = result.no_match_reason == intent.MatchFailedReason.DUPLICATE_NAME
        return "ambiguous" if duplicate else "no_match"
    return [state.entity_id for state in result.states]


def _window(args: dict[str, Any]) -> tuple[datetime, datetime | None] | str:
    """When an action starts and ends, from the assistant's arguments, or why it cannot tell.

    The same rules as `domotwin.schedule`'s (`schedules.times`).
    """
    if "start" not in args and "in_minutes" not in args:
        return "no_start"
    try:
        at = moment(args["start"]) if "start" in args else None
        until = moment(args["end"]) if "end" in args else None
    except vol.Invalid:
        return "bad_time"
    delay = timedelta(minutes=args["in_minutes"]) if "in_minutes" in args else None
    duration = timedelta(minutes=args["for_minutes"]) if "for_minutes" in args else None
    return times(at, delay, until, duration)


def _said(hass: HomeAssistant, item: Scheduled) -> dict[str, Any]:
    """An action as the assistant is told it."""
    return {
        "id": item.id,
        "devices": [
            state.name if (state := hass.states.get(e)) is not None else e for e in item.entities
        ],
        "text": describe(hass, item),
    }


class ScheduleTool(Tool):
    """Switches devices on or off later, and back off after a while."""

    name = "domotwin__schedule"
    title = "Schedule a device"
    description = (
        "Switches a device on or off later: at a local date and time, or in some minutes; with "
        "turn_on, optionally back off at a time or after some minutes, lights at a brightness. "
        "Covers open (turn_on) and close (turn_off). Answers a sentence saying what will happen."
    )
    annotations = ToolAnnotations(destructive=False, open_world=False)
    integration = DOMAIN
    parameters = vol.Schema(
        {
            **TARGET,
            vol.Optional("action", description="turn_on (or open) or turn_off (or close)."): vol.In(
                ["turn_on", "turn_off"]
            ),
            vol.Optional(
                "start", description="When: a local date and time, YYYY-MM-DDTHH:MM:SS."
            ): cv.string,
            vol.Optional("in_minutes", description="When: in this many minutes."): vol.All(
                vol.Coerce(int), vol.Range(min=0, max=525_600)
            ),
            vol.Optional(
                "end", description="With turn_on: when to switch off, local YYYY-MM-DDTHH:MM:SS."
            ): cv.string,
            vol.Optional(
                "for_minutes", description="With turn_on: switch off after this many minutes."
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=10_080)),
            vol.Optional(
                "brightness", description="With turn_on: the light's brightness, 1 to 100 %."
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
        }
    )

    @override
    async def async_call(
        self, hass: HomeAssistant, tool_input: ToolInput, llm_context: LLMContext
    ) -> ToolResult:
        """Sets the action, or says why it cannot be."""
        args = self.parameters(tool_input.tool_args)
        scheduler: Scheduler | None = hass.data.get(SCHEDULER_KEY)
        if scheduler is None:
            return _refused("not_loaded")
        targets = _targets(hass, llm_context, args["name"], args.get("area"))
        if isinstance(targets, str):
            return _refused(targets)
        window = _window(args)
        if isinstance(window, str):
            return _refused(window)
        start, end = window
        action = "off" if args.get("action") == "turn_off" else "on"
        # Only on what who speaks may use in DomoTwin (D-070); a satellite's voice is nobody's.
        levels = await _levels(hass, llm_context)
        if levels is not None and not levels.uses(targets):
            return _refused("not_allowed")
        try:
            item = await scheduler.async_add(
                targets, action, start, end, args.get("brightness"), user_id=_user(llm_context)
            )
        except ScheduleError as err:
            return _refused(err.code)
        return ToolResult(data={"success": True, **_said(hass, item)})


class ListSchedulesTool(Tool):
    """The actions waiting on the devices exposed to the assistant."""

    name = "domotwin__list_schedules"
    title = "List scheduled actions"
    description = "Lists the device actions set for later, the soonest first."
    annotations = ToolAnnotations(
        read_only=True, destructive=False, idempotent=True, open_world=False
    )
    integration = DOMAIN

    @override
    async def async_call(
        self, hass: HomeAssistant, tool_input: ToolInput, llm_context: LLMContext
    ) -> ToolResult:
        """Says the actions waiting."""
        scheduler: Scheduler | None = hass.data.get(SCHEDULER_KEY)
        if scheduler is None:
            return _refused("not_loaded")
        # What who speaks may not see in DomoTwin is not said either (D-070).
        levels = await _levels(hass, llm_context)
        exposed = [
            item
            for item in scheduler.items()
            if all(async_should_expose(hass, llm_context.assistant, e) for e in item.entities)
            and (levels is None or not any(levels.level(e) == HIDDEN for e in item.entities))
        ]
        return ToolResult(data={"schedules": [_said(hass, item) for item in exposed]})


class CancelScheduleTool(Tool):
    """Cancels the actions waiting on a device."""

    name = "domotwin__cancel_schedule"
    title = "Cancel scheduled actions"
    description = (
        "Cancels the actions set for later on a device. A device already switched on stays on."
    )
    annotations = ToolAnnotations(destructive=False, idempotent=True, open_world=False)
    integration = DOMAIN
    parameters = vol.Schema(TARGET)

    @override
    async def async_call(
        self, hass: HomeAssistant, tool_input: ToolInput, llm_context: LLMContext
    ) -> ToolResult:
        """Cancels them; answers how many there were."""
        args = self.parameters(tool_input.tool_args)
        scheduler: Scheduler | None = hass.data.get(SCHEDULER_KEY)
        if scheduler is None:
            return _refused("not_loaded")
        targets = _targets(hass, llm_context, args["name"], args.get("area"))
        if isinstance(targets, str):
            return _refused(targets)
        # Only the actions the assistant may see whole, as it lists them.
        items = [
            item
            for item in scheduler.of_entities(targets)
            if all(async_should_expose(hass, llm_context.assistant, e) for e in item.entities)
        ]
        levels = await _levels(hass, llm_context)
        if levels is not None and not levels.uses(e for item in items for e in item.entities):
            return _refused("not_allowed")
        ids = [item.id for item in items]
        try:
            cancelled = await scheduler.async_cancel(ids, _user(llm_context))
        except ScheduleError as err:
            return _refused(err.code)
        return ToolResult(data={"success": True, "cancelled": cancelled})


@callback
def async_get_tools(hass: HomeAssistant, llm_context: LLMContext, api_id: str) -> LLMTools | None:
    """DomoTwin's tools, for Home Assistant's own API, once DomoTwin is set up."""
    if api_id != LLM_API_ASSIST or SCHEDULER_KEY not in hass.data:
        return None
    return LLMTools(
        tools=[ScheduleTool(), ListSchedulesTool(), CancelScheduleTool()], prompt=PROMPT
    )
