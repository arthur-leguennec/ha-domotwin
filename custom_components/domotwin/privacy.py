"""Private rooms (`DECISIONS.md`, D-039): which rooms a viewer may not see.

A private room is kept for the people chosen (none: for nobody), always or only while an entity is
on. A viewer is one of the people through the Home Assistant user of their `person`; a shared
screen's user, an automation or a voice satellite is nobody's, so the room stays private there.
DomoTwin locks its own views, controls and answers: Home Assistant gives every user every entity
elsewhere (its permissions are by user, not by entity).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from homeassistant.core import State


def private_rooms(
    rooms: Mapping[str, Mapping[str, Any]],
    state_of: Callable[[str], State | None],
    user_id: str | None,
) -> set[str]:
    """The rooms the user `user_id` (`None`: nobody's) may not see now.

    `rooms` are the home's private rooms (`settings["rooms"]`): `{room id: {"people": [person
    entity ids], "while"?: entity id}}`. A room private `while` an entity is on is open when that
    entity is off; unavailable or unknown, it stays private.
    """
    hidden: set[str] = set()
    for room, rule in rooms.items():
        entity = rule.get("while")
        if entity is not None and (state := state_of(entity)) is not None and state.state == "off":
            continue
        if user_id is not None and any(
            (person := state_of(p)) is not None and person.attributes.get("user_id") == user_id
            for p in rule.get("people", [])
        ):
            continue
        hidden.add(room)
    return hidden
