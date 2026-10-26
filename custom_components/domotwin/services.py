"""DomoTwin's actions.

- `domotwin.show` (docs/DECISIONS.md, D-029): what the screens show. A request names a room or an
  element (by id or by name), a storey, a view, a person (their room, D-034), or several of them,
  and optionally the screen (a card's `screen` option) that shows it; every DomoTwin view
  listening gets it over `domotwin/subscribe` and finds the room in its plans.
- `domotwin.where` (D-034): where a person is, or everyone at home, with a sentence to answer;
  where a device followed by Bluetooth is too (D-035: "where are my keys?").
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
from .data import DATA_KEY, LOCATOR_KEY, PEOPLE_KEY
from .people import Place, likeness, thing_likeness
from .privacy import private_rooms
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
        "unheard": "I cannot hear {name} now.",
        "heard": "I hear {name} in the {room}.",
        "nobody": "Nobody is home.",
        "and": ", ",
        "also": "{name} in the {room}",
        "private_room": "{name} is in a private room.",
        "also_private": "{name} in a private room",
        "heard_private": "I hear {name} in a private room.",
    },
    "fr": {
        "room": "{name} est dans la pièce {room}.",
        "somewhere": "{name} est à la maison, je ne sais pas dans quelle pièce.",
        "away": "{name} n'est pas à la maison.",
        "unknown": "Je ne connais pas {name}.",
        "private": "Je ne peux pas dire où est {name}.",
        "unheard": "Je n'entends pas {name} en ce moment.",
        "heard": "J'entends {name} dans la pièce {room}.",
        "nobody": "Personne n'est à la maison.",
        "and": ", ",
        "also": "{name} dans la pièce {room}",
        "private_room": "{name} est dans une pièce privée.",
        "also_private": "{name} dans une pièce privée",
        "heard_private": "J'entends {name} dans une pièce privée.",
    },
}


def _place_text(said: dict[str, str], name: str, place: Place | None, closed: set[str]) -> str:
    if place is None or not place.home:
        return said["away"].format(name=name)
    if place.room is None:
        return said["somewhere"].format(name=name)
    if place.room.id in closed:
        return said["private_room"].format(name=name)
    return said["room"].format(name=name, room=place.room.name)


def _entry(name: str, person: str, place: Place | None, closed: set[str]) -> dict[str, Any]:
    entry: dict[str, Any] = {"person": person, "name": name, "home": bool(place and place.home)}
    if place is not None and place.room is not None:
        if place.room.id in closed:
            # In a private room (D-039): not which.
            entry["private"] = True
            return entry
        entry.update(
            room=place.room.name,
            room_id=place.room.id,
            storey=place.room.storey_name,
            since=place.since.isoformat() if place.since else None,
        )
    return entry


async def _limits(hass: HomeAssistant, call: ServiceCall) -> tuple[set[str], set[str]]:
    """What the one calling may not be told: people, and rooms.

    The people not to show or tell about (`PeopleTracker.untold`), and the private rooms they may
    not see (D-039).
    """
    user_id = call.context.user_id
    user = await hass.auth.async_get_user(user_id) if user_id else None
    people = hass.data.get(PEOPLE_KEY)
    untold = people.untold(user) if people is not None else set()
    data = hass.data.get(DATA_KEY)
    rooms = data.settings.get("rooms", {}) if data is not None else {}
    return untold, private_rooms(rooms, hass.states.get, user.id if user else None)


async def _async_where(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Where a person is (`name`), or everyone at home, with a sentence to say."""
    said = SENTENCES["fr" if hass.config.language.startswith("fr") else "en"]
    people = hass.data.get(PEOPLE_KEY)
    placed = list(people.config["people"]) if people is not None else []
    places = people.places if people is not None else {}
    untold, closed = await _limits(hass, call)
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
            entries.append(_entry(name, person, place, closed))
            if clauses and place is not None and place.room is not None:
                also = said["also_private"] if place.room.id in closed else said["also"]
                clauses.append(also.format(name=name, room=place.room.name))
            else:
                clauses.append(_place_text(said, name, place, closed).rstrip("."))
        return {"people": entries, "text": said["and"].join(clauses) + "."}
    scored = [
        (score, person)
        for person in placed
        if (score := likeness(asked, [name_of(hass, person), person.split(".", 1)[1]])) is not None
    ]
    locator = hass.data.get(LOCATOR_KEY)
    devices = locator.settings["devices"] if locator is not None else {}
    scored += [
        (score, f"@{device}")
        for device, settings in devices.items()
        if (score := thing_likeness(asked, settings["name"])) is not None
    ]
    best = min((score for score, _ in scored), default=None)
    found = [person for score, person in scored if score == best]
    # A person and a thing as alike ("Alex" and "Alex's phone"): the person is meant.
    people_found = [person for person in found if not person.startswith("@")]
    if people_found:
        found = people_found
    if len(found) != 1:
        return {"people": [], "text": said["unknown"].format(name=asked)}
    person = found[0]
    if person.startswith("@") and locator is not None:
        return _where_thing(hass, call, said, (untold, closed), person[1:])
    name = name_of(hass, person)
    if person in untold:
        return {"people": [], "text": said["private"].format(name=name)}
    place = places.get(person)
    if (
        call.data["show"]
        and place is not None
        and place.room is not None
        and place.room.id not in closed
    ):
        request = {"room": place.room.id}
        if call.data["screen"]:
            request["screen"] = call.data["screen"]
        async_dispatcher_send(hass, SIGNAL_SHOW, request)
    return {
        "people": [_entry(name, person, place, closed)],
        "text": _place_text(said, name, place, closed),
    }


def _where_thing(
    hass: HomeAssistant,
    call: ServiceCall,
    said: dict[str, str],
    limits: tuple[set[str], set[str]],
    device: str,
) -> ServiceResponse:
    """Where a device followed by Bluetooth is; not told when its owner is not to be told about."""
    locator, people = hass.data[LOCATOR_KEY], hass.data.get(PEOPLE_KEY)
    untold, closed = limits
    settings = locator.settings["devices"][device]
    name = settings["name"]
    if settings.get("person") in untold:
        return {"people": [], "things": [], "text": said["private"].format(name=name)}
    located = locator.located.get(device)
    room = (
        people.finder.room(located.room)
        if people is not None and located is not None and located.room
        else None
    )
    entry: dict[str, Any] = {"device": device, "name": name, "kind": settings["kind"]}
    if room is None or located is None:
        return {"people": [], "things": [entry], "text": said["unheard"].format(name=name)}
    if room.id in closed:
        entry["private"] = True
        return {"people": [], "things": [entry], "text": said["heard_private"].format(name=name)}
    entry.update(
        room=room.name,
        room_id=room.id,
        storey=room.storey_name,
        since=located.since.isoformat() if located.since else None,
        left_behind=located.left_behind,
    )
    if call.data["show"]:
        request = {"room": room.id}
        if call.data["screen"]:
            request["screen"] = call.data["screen"]
        async_dispatcher_send(hass, SIGNAL_SHOW, request)
    return {
        "people": [],
        "things": [entry],
        "text": said["heard"].format(name=name, room=room.name),
    }


@callback
def async_register_services(hass: HomeAssistant) -> None:
    """Register `domotwin.show` and `domotwin.where` (once, at integration setup)."""

    async def show(call: ServiceCall) -> None:
        request = {key: value for key, value in call.data.items() if value != ""}
        person = request.pop("person", None)
        if person is not None:
            # A person is shown in their room; nowhere when not placed, or not to be shown.
            people = hass.data.get(PEOPLE_KEY)
            untold, closed = await _limits(hass, call)
            if people is None or person in untold:
                return
            place = people.places.get(person)
            # Not in a private room either: showing it would tell where they are (D-039).
            if place is None or place.room is None or place.room.id in closed:
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
