"""DomoTwin's actions.

- `domotwin.show` (docs/DECISIONS.md, D-029): what the screens show. A request names a room or an
  element (by id or by name), a storey, a view, a person (their room, D-034), or several of them,
  and optionally the screen (a card's `screen` option) that shows it; every DomoTwin view
  listening gets it over `domotwin/subscribe` and finds the room in its plans.
- `domotwin.where` (D-034): where a person is, or everyone at home, with a sentence to answer.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util.json import JsonValueType

from .compat import vol
from .const import (
    DOMAIN,
    MAX_SCREEN_NAME,
    MAX_SHOW_TEXT,
    SERVICE_SHOW,
    SERVICE_WHERE,
    SIGNAL_SHOW,
)
from .data import PEOPLE_KEY
from .people import Place, likeness
from .tracker import name_of

SCREEN = re.compile(rf"^[A-Za-z0-9_-]{{1,{MAX_SCREEN_NAME}}}$")


def _text(value: Any) -> str:
    text = cv.string(value).strip()
    if not text or len(text) > MAX_SHOW_TEXT:
        raise vol.Invalid(f"expected 1 to {MAX_SHOW_TEXT} characters")
    return text


def _screen(value: Any) -> str:
    """A screen's name, or the empty string for every screen."""
    text = cv.string(value).strip()
    if text and not SCREEN.match(text):
        raise vol.Invalid("a screen's name is made of letters, digits, _ and -")
    return text


SHOW_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Optional("room"): _text,
            vol.Optional("element"): _text,
            vol.Optional("storey"): _text,
            vol.Optional("view"): _text,
            vol.Optional("person"): cv.entity_id,
            vol.Optional("screen", default=""): _screen,
        }
    ),
    cv.has_at_least_one_key("room", "element", "storey", "view", "person"),
)

WHERE_SCHEMA = vol.Schema(
    {
        vol.Optional("name"): cv.string,
        vol.Optional("show", default=False): cv.boolean,
        vol.Optional("screen", default=""): _screen,
    }
)

# What `domotwin.where` says, in English and in French (Home Assistant's language).
SENTENCES = {
    "en": {
        "room": "{name} is in the {room}.",
        "somewhere": "{name} is home, in a room I cannot tell.",
        "away": "{name} is not home.",
        "unknown": "I do not know who {name} is.",
        "private": "I cannot tell where {name} is.",
        "nobody": "Nobody is home.",
        "and": ", ",
        "also": "{name} in the {room}",
    },
    "fr": {
        "room": "{name} est dans la pièce {room}.",
        "somewhere": "{name} est à la maison, je ne sais pas dans quelle pièce.",
        "away": "{name} n'est pas à la maison.",
        "unknown": "Je ne connais pas {name}.",
        "private": "Je ne peux pas dire où est {name}.",
        "nobody": "Personne n'est à la maison.",
        "and": ", ",
        "also": "{name} dans la pièce {room}",
    },
}


def _place_text(said: dict[str, str], name: str, place: Place | None) -> str:
    if place is None or not place.home:
        return said["away"].format(name=name)
    if place.room is None:
        return said["somewhere"].format(name=name)
    return said["room"].format(name=name, room=place.room.name)


def _entry(name: str, person: str, place: Place | None) -> dict[str, Any]:
    entry: dict[str, Any] = {"person": person, "name": name, "home": bool(place and place.home)}
    if place is not None and place.room is not None:
        entry.update(
            room=place.room.name,
            room_id=place.room.id,
            storey=place.room.storey_name,
            since=place.since.isoformat() if place.since else None,
        )
    return entry


async def _untold(hass: HomeAssistant, call: ServiceCall) -> set[str]:
    """The people not to show or tell about to the one calling (`PeopleTracker.untold`)."""
    people = hass.data.get(PEOPLE_KEY)
    if people is None:
        return set()
    user_id = call.context.user_id
    user = await hass.auth.async_get_user(user_id) if user_id else None
    return people.untold(user)


async def _async_where(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Where a person is (`name`), or everyone at home, with a sentence to say."""
    said = SENTENCES["fr" if hass.config.language.startswith("fr") else "en"]
    people = hass.data.get(PEOPLE_KEY)
    placed = list(people.config["people"]) if people is not None else []
    places = people.places if people is not None else {}
    untold = await _untold(hass, call)
    asked = call.data.get("name", "").strip()
    if not asked:
        # Everyone at home, and where (those not told about left out).
        home = [
            p
            for p in placed
            if p not in untold and (place := places.get(p)) is not None and place.home
        ]
        if not home:
            return {"people": [], "text": said["nobody"]}
        entries: list[JsonValueType] = []
        clauses: list[str] = []
        for person in home:
            name, place = name_of(hass, person), places.get(person)
            entries.append(_entry(name, person, place))
            if clauses and place is not None and place.room is not None:
                clauses.append(said["also"].format(name=name, room=place.room.name))
            else:
                clauses.append(_place_text(said, name, place).rstrip("."))
        return {"people": entries, "text": said["and"].join(clauses) + "."}
    scored = [
        (score, person)
        for person in placed
        if (score := likeness(asked, [name_of(hass, person), person.split(".", 1)[1]])) is not None
    ]
    best = min((score for score, _ in scored), default=None)
    found = [person for score, person in scored if score == best]
    if len(found) != 1:
        return {"people": [], "text": said["unknown"].format(name=asked)}
    person = found[0]
    name = name_of(hass, person)
    if person in untold:
        return {"people": [], "text": said["private"].format(name=name)}
    place = places.get(person)
    if call.data["show"] and place is not None and place.room is not None:
        request = {"room": place.room.id}
        if call.data["screen"]:
            request["screen"] = call.data["screen"]
        async_dispatcher_send(hass, SIGNAL_SHOW, request)
    return {"people": [_entry(name, person, place)], "text": _place_text(said, name, place)}


@callback
def async_register_services(hass: HomeAssistant) -> None:
    """Register `domotwin.show` and `domotwin.where` (once, at integration setup)."""

    async def show(call: ServiceCall) -> None:
        request = {key: value for key, value in call.data.items() if value != ""}
        person = request.pop("person", None)
        if person is not None:
            # A person is shown in their room; nowhere when not placed, or not to be shown.
            people = hass.data.get(PEOPLE_KEY)
            if people is None or person in await _untold(hass, call):
                return
            place = people.places.get(person)
            if place is None or place.room is None:
                return
            request["room"] = place.room.id
        async_dispatcher_send(hass, SIGNAL_SHOW, request)

    async def where(call: ServiceCall) -> ServiceResponse:
        return await _async_where(hass, call)

    hass.services.async_register(DOMAIN, SERVICE_SHOW, show, schema=SHOW_SCHEMA)
    hass.services.async_register(
        DOMAIN,
        SERVICE_WHERE,
        where,
        schema=WHERE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
