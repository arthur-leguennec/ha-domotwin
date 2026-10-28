"""DomoTwin's actions.

- `domotwin.show` (docs/DECISIONS.md, D-029): what the screens show. A request names a room or an
  element (by id or by name), a storey, a view, a person (their room, D-034), or several of them,
  and optionally the screen (a card's `screen` option) that shows it; every DomoTwin view
  listening gets it over `domotwin/subscribe` and finds the room in its plans.
- `domotwin.where` (D-034): where a person is, or everyone at home, with a sentence to answer;
  where a device followed by Bluetooth is too (D-035: "where are my keys?").
- `domotwin.schedule` and `domotwin.unschedule` (D-046): an action done later, and cancelled.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util.json import JsonValueType

from .compat import vol
from .const import (
    DOMAIN,
    MAX_SCHEDULE_DAYS,
    MAX_SCHEDULE_ENTITIES,
    MAX_SHOW_TEXT,
    SCREEN_NAME,
    SERVICE_SCHEDULE,
    SERVICE_SHOW,
    SERVICE_UNSCHEDULE,
    SERVICE_WHERE,
    SIGNAL_SHOW,
)
from .data import DATA_KEY, LOCATOR_KEY, PEOPLE_KEY, SCHEDULER_KEY
from .language import spoken
from .people import Place, likeness, norm, thing_likeness
from .privacy import private_rooms
from .rights import hidden_rooms
from .schedules import ScheduleError, describe, moment, times
from .tracker import name_of


def _text(value: Any) -> str:
    text = cv.string(value).strip()
    if not text or len(text) > MAX_SHOW_TEXT:
        raise vol.Invalid(f"expected 1 to {MAX_SHOW_TEXT} characters")
    return text


def _screen(value: Any) -> str:
    """A screen's name, or the empty string for every screen."""
    text = cv.string(value).strip()
    if text and not SCREEN_NAME.fullmatch(text):
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


SCHEDULE_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Required("entity_id"): vol.All(
                cv.entity_ids, vol.Length(min=1, max=MAX_SCHEDULE_ENTITIES)
            ),
            vol.Optional("action", default="on"): vol.In(("on", "off")),
            vol.Exclusive("at", "start"): moment,
            vol.Exclusive("delay", "start"): vol.All(
                cv.positive_time_period, vol.Range(max=timedelta(days=MAX_SCHEDULE_DAYS))
            ),
            vol.Exclusive("until", "end"): moment,
            vol.Exclusive("duration", "end"): vol.All(
                cv.positive_time_period, vol.Range(max=timedelta(days=MAX_SCHEDULE_DAYS))
            ),
            vol.Optional("brightness"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
        }
    ),
    cv.has_at_least_one_key("at", "delay"),
)

UNSCHEDULE_SCHEMA = vol.All(
    vol.Schema({vol.Optional("id"): cv.string, vol.Optional("entity_id"): cv.entity_ids}),
    cv.has_at_least_one_key("id", "entity_id"),
)


# What `domotwin.where` says, in each language DomoTwin speaks (Home Assistant's, D-082).
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
        "stop": ".",
        "also": "{name} in the {room}",
        "private_room": "{name} is in a private room.",
        "also_private": "{name} in a private room",
        "heard_private": "I hear {name} in a private room.",
        "counted": (
            "This is a workplace: I count people, I do not say where anyone is. "
            "People here: {count}."
        ),
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
        "stop": ".",
        "also": "{name} dans la pièce {room}",
        "private_room": "{name} est dans une pièce privée.",
        "also_private": "{name} dans une pièce privée",
        "heard_private": "J'entends {name} dans une pièce privée.",
        "counted": (
            "C'est un lieu de travail : je compte les personnes, je ne dis pas où est chacun. "
            "Présents : {count}."
        ),
    },
    "de": {
        "room": "{name} ist im Raum {room}.",
        "somewhere": "{name} ist zu Hause, aber ich weiß nicht, in welchem Raum.",
        "away": "{name} ist nicht zu Hause.",
        "unknown": "Ich weiß nicht, wer {name} ist.",
        "private": "Ich kann nicht sagen, wo {name} ist.",
        "unheard": "Ich empfange gerade kein Signal von {name}.",
        "heard": "Das Signal von {name} kommt aus dem Raum {room}.",
        "nobody": "Niemand ist zu Hause.",
        "and": ", ",
        "stop": ".",
        "also": "{name} im Raum {room}",
        "private_room": "{name} ist in einem privaten Raum.",
        "also_private": "{name} in einem privaten Raum",
        "heard_private": "Das Signal von {name} kommt aus einem privaten Raum.",
        "counted": (
            "Dies ist ein Arbeitsplatz: Ich zähle Personen, sage aber nicht, wo jemand ist. "
            "Anwesend: {count}."
        ),
    },
    "es": {
        "room": "{name} está en la habitación {room}.",
        "somewhere": "{name} está en casa, pero no sé en qué habitación.",
        "away": "{name} no está en casa.",
        "unknown": "No sé quién es {name}.",
        "private": "No puedo decir dónde está {name}.",
        "unheard": "Ahora mismo no recibo la señal de {name}.",
        "heard": "La señal de {name} viene de la habitación {room}.",
        "nobody": "No hay nadie en casa.",
        "and": ", ",
        "stop": ".",
        "also": "{name} en la habitación {room}",
        "private_room": "{name} está en una habitación privada.",
        "also_private": "{name} en una habitación privada",
        "heard_private": "La señal de {name} viene de una habitación privada.",
        "counted": (
            "Esto es un lugar de trabajo: cuento a las personas, no digo dónde está nadie. "
            "Presentes: {count}."
        ),
    },
    "it": {
        "room": "{name} è nella stanza {room}.",
        "somewhere": "{name} è a casa, ma non so in quale stanza.",
        "away": "{name} non è a casa.",
        "unknown": "Non so chi sia {name}.",
        "private": "Non posso dire dove si trovi {name}.",
        "unheard": "Al momento non ricevo il segnale di {name}.",
        "heard": "Il segnale di {name} arriva dalla stanza {room}.",
        "nobody": "Non c'è nessuno in casa.",
        "and": ", ",
        "stop": ".",
        "also": "{name} nella stanza {room}",
        "private_room": "{name} è in una stanza privata.",
        "also_private": "{name} in una stanza privata",
        "heard_private": "Il segnale di {name} arriva da una stanza privata.",
        "counted": (
            "Questo è un luogo di lavoro: conto le persone, non dico dove si trova nessuno. "
            "Presenti: {count}."
        ),
    },
    "nl": {
        "room": "{name} is in de ruimte {room}.",
        "somewhere": "{name} is thuis, maar ik weet niet in welke ruimte.",
        "away": "{name} is niet thuis.",
        "unknown": "Ik weet niet wie {name} is.",
        "private": "Ik kan niet zeggen waar {name} is.",
        "unheard": "Ik ontvang nu geen signaal van {name}.",
        "heard": "Het signaal van {name} komt uit de ruimte {room}.",
        "nobody": "Er is niemand thuis.",
        "and": ", ",
        "stop": ".",
        "also": "{name} in de ruimte {room}",
        "private_room": "{name} is in een privéruimte.",
        "also_private": "{name} in een privéruimte",
        "heard_private": "Het signaal van {name} komt uit een privéruimte.",
        "counted": (
            "Dit is een werkplek: ik tel mensen, ik zeg niet waar iemand is. Aanwezig: {count}."
        ),
    },
    "pt": {
        "room": "{name} está na divisão {room}.",
        "somewhere": "{name} está em casa, mas não sei em que divisão.",
        "away": "{name} não está em casa.",
        "unknown": "Não sei quem é {name}.",
        "private": "Não posso dizer onde está {name}.",
        "unheard": "Neste momento não recebo o sinal de {name}.",
        "heard": "O sinal de {name} vem da divisão {room}.",
        "nobody": "Não está ninguém em casa.",
        "and": ", ",
        "stop": ".",
        "also": "{name} na divisão {room}",
        "private_room": "{name} está numa divisão privada.",
        "also_private": "{name} numa divisão privada",
        "heard_private": "O sinal de {name} vem de uma divisão privada.",
        "counted": (
            "Isto é um local de trabalho: conto as pessoas, não digo onde está ninguém. "
            "Presentes: {count}."
        ),
    },
    "pt-BR": {
        "room": "{name} está no cômodo {room}.",
        "somewhere": "{name} está em casa, mas não sei em qual cômodo.",
        "away": "{name} não está em casa.",
        "unknown": "Não sei quem é {name}.",
        "private": "Não posso dizer onde {name} está.",
        "unheard": "No momento, não estou recebendo o sinal de {name}.",
        "heard": "O sinal de {name} vem do cômodo {room}.",
        "nobody": "Não há ninguém em casa.",
        "and": ", ",
        "stop": ".",
        "also": "{name} no cômodo {room}",
        "private_room": "{name} está em um cômodo privado.",
        "also_private": "{name} em um cômodo privado",
        "heard_private": "O sinal de {name} vem de um cômodo privado.",
        "counted": (
            "Este é um local de trabalho: eu conto as pessoas, não digo onde ninguém está. "
            "Presentes: {count}."
        ),
    },
    "ar": {
        "room": "{name} في غرفة {room}.",
        "somewhere": "{name} في المنزل، لكنني لا أعرف في أي غرفة.",
        "away": "{name} خارج المنزل.",
        "unknown": "لا أعرف أحدًا باسم {name}.",
        "private": "لا يمكنني الإفصاح عن مكان {name}.",
        "unheard": "لا أستقبل إشارة {name} الآن.",
        "heard": "تصلني إشارة {name} من غرفة {room}.",
        "nobody": "لا أحد في المنزل.",
        "and": "، و",
        "stop": ".",
        "also": "{name} في غرفة {room}",
        "private_room": "{name} في غرفة خاصة.",
        "also_private": "{name} في غرفة خاصة",
        "heard_private": "تصلني إشارة {name} من غرفة خاصة.",
        "counted": "هذا مكان عمل: أعدّ الأشخاص ولا أقول أين يوجد أحد. الحاضرون: {count}.",
    },
    "zh-Hans": {
        "room": "{name}在{room}。",
        "somewhere": "{name}在家\uff0c但我不知道在哪个房间。",
        "away": "{name}不在家。",
        "unknown": "我不知道{name}是谁。",
        "private": "我不能透露{name}在哪里。",
        "unheard": "现在接收不到{name}的信号。",
        "heard": "{name}的信号来自{room}。",
        "nobody": "家里没有人。",
        "and": "\uff0c",
        "stop": "。",
        "also": "{name}在{room}",
        "private_room": "{name}在一个私密房间里。",
        "also_private": "{name}在一个私密房间里",
        "heard_private": "{name}的信号来自一个私密房间。",
        "counted": "这里是工作场所\uff0c我只统计人数\uff0c不说任何人在哪里。现在有{count}人在场。",
    },
    "ja": {
        "room": "{name}は{room}にいます。",
        "somewhere": "{name}は家にいますが、どの部屋かはわかりません。",
        "away": "{name}は家にいません。",
        "unknown": "{name}が誰なのかわかりません。",
        "private": "{name}の居場所はお伝えできません。",
        "unheard": "今は{name}の信号を受信できません。",
        "heard": "{name}の信号は{room}から届いています。",
        "nobody": "家には誰もいません。",
        "and": "、",
        "stop": "。",
        "also": "{name}は{room}にいます",
        "private_room": "{name}はプライベートな部屋にいます。",
        "also_private": "{name}はプライベートな部屋にいます",
        "heard_private": "{name}の信号はプライベートな部屋から届いています。",
        "counted": (
            "ここは職場です。人数は数えますが、誰がどこにいるかは言いません。"
            "今いるのは{count}人です。"
        ),
    },
    "ko": {
        "room": "{name} 지금 {room}에 있어요.",
        "somewhere": "{name} 지금 집에 있는데, 어느 방인지는 모르겠어요.",
        "away": "{name} 지금 집에 없어요.",
        "unknown": "누가 {name}인지 모르겠어요.",
        "private": "{name}의 위치는 알려 드릴 수 없어요.",
        "unheard": "지금은 {name}의 신호가 잡히지 않아요.",
        "heard": "{name}의 신호가 {room}에서 잡혀요.",
        "nobody": "지금 집에 아무도 없어요.",
        "and": ". ",
        "stop": ".",
        "also": "{name} {room}에 있어요",
        "private_room": "{name} 지금 비공개 공간에 있어요.",
        "also_private": "{name} 비공개 공간에 있어요",
        "heard_private": "{name}의 신호가 비공개 공간에서 잡혀요.",
        "counted": (
            "여기는 직장이에요. 인원은 세지만 누가 어디 있는지는 말하지 않아요. "
            "지금 {count}명 있어요."
        ),
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

    The people not to show or tell about (`PeopleTracker.untold`), and the rooms they may not see:
    private (D-039), or hidden by their rights (D-071).
    """
    user_id = call.context.user_id
    user = await hass.auth.async_get_user(user_id) if user_id else None
    people = hass.data.get(PEOPLE_KEY)
    untold = people.untold(user) if people is not None else set()
    data = hass.data.get(DATA_KEY)
    settings = data.settings if data is not None else {}
    closed = private_rooms(settings.get("rooms", {}), hass.states.get, user.id if user else None)
    return untold, closed | hidden_rooms(hass, settings, user)


async def _async_where(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Where a person is (`name`), or everyone at home, with a sentence to say.

    In a workplace (D-086), how many are here: where anyone is, it tells no one; a thing followed
    by Bluetooth (keys, a bag; not a phone nor a watch) is still found.
    """
    said = SENTENCES[spoken(hass.config.language)]
    limits = await _limits(hass, call)
    if _workplace(hass):
        return _where_at_work(hass, call, said, limits)
    return _where_named(hass, call, said, limits)


def _workplace(hass: HomeAssistant) -> bool:
    """Whether the home is a workplace (D-086): its people counted, never named."""
    data = hass.data.get(DATA_KEY)
    return data is not None and data.workplace


def _scored_people(hass: HomeAssistant, asked: str, people: list[str]) -> list[tuple[int, str]]:
    """How alike a name is to each person's (their name in Home Assistant, or their entity's)."""
    return [
        (score, person)
        for person in people
        if (score := likeness(asked, [name_of(hass, person), person.split(".", 1)[1]])) is not None
    ]


def _scored_things(
    hass: HomeAssistant, asked: str, kinds: tuple[str, ...] | None = None
) -> list[tuple[int, str]]:
    """How alike a name is to each device followed by Bluetooth (of these kinds), as `@device`."""
    locator = hass.data.get(LOCATOR_KEY)
    devices = locator.settings["devices"] if locator is not None else {}
    return [
        (score, f"@{device}")
        for device, settings in devices.items()
        if (kinds is None or settings["kind"] in kinds)
        and (score := thing_likeness(asked, settings["name"])) is not None
    ]


def _best(scored: list[tuple[int, str]]) -> list[str]:
    """Those the likeliest, a name alike to them all."""
    best = min((score for score, _ in scored), default=None)
    return [found for score, found in scored if score == best]


def _where_at_work(
    hass: HomeAssistant,
    call: ServiceCall,
    said: dict[str, str],
    limits: tuple[set[str], set[str]],
) -> ServiceResponse:
    """In a workplace (D-086): how many are here; a thing by its name; where a person is, never.

    A name like anyone's, placed or not, or like their phone's or watch's, is answered with how many
    are here: a thing named after them ("Alex's keys") would tell where they likely are.
    """
    asked = call.data.get("name", "").strip()
    persons = [state.entity_id for state in hass.states.async_all("person")]
    if (
        not asked
        or _scored_people(hass, asked, persons)
        or _scored_things(hass, asked, ("phone", "watch"))
    ):
        return _where_counted(hass, said, limits)
    found = _best(_scored_things(hass, asked, ("thing",)))
    if len(found) != 1:
        return {"people": [], "text": said["unknown"].format(name=asked)}
    device = found[0][1:]
    # Named after someone ("Alex's keys"): where it is would tell where they likely are.
    if _named_after(hass, hass.data[LOCATOR_KEY].settings["devices"][device]["name"], persons):
        return _where_counted(hass, said, limits)
    return _where_thing(hass, call, said, limits, device)


def _named_after(hass: HomeAssistant, name: str, people: list[str]) -> bool:
    """Whether a thing's name holds a person's first name ("Alex's keys", "badge Alex")."""
    words = set(norm(name).split(" "))
    for person in people:
        for full in (name_of(hass, person), person.split(".", 1)[1]):
            first = norm(full).split(" ")[0]
            if first and first in words:
                return True
    return False


def _where_counted(
    hass: HomeAssistant, said: dict[str, str], limits: tuple[set[str], set[str]]
) -> ServiceResponse:
    """How many are here, as the Home tab counts them (`glance.ts`).

    The people placed at home and those the radars see without a name; with nobody placed, those
    the radars see, or without radars Home Assistant's people at home. Those not to be told about
    are not counted.
    """
    untold, closed = limits
    people = hass.data.get(PEOPLE_KEY)
    locator = hass.data.get(LOCATOR_KEY)
    seen = (
        sum(1 for t in locator.radar.seen.values() if t.room not in closed)
        if locator is not None
        else 0
    )
    placed = list(people.config["people"]) if people is not None else []
    if people is not None and placed:
        places = people.places
        here = seen + sum(
            1
            for p in placed
            if p not in untold and (place := places.get(p)) is not None and place.home
        )
    elif locator is not None and locator.radar.radars:
        here = seen
    else:
        here = sum(1 for state in hass.states.async_all("person") if state.state == "home")
    return {"people": [], "text": said["counted"].format(count=here)}


def _where_named(
    hass: HomeAssistant,
    call: ServiceCall,
    said: dict[str, str],
    limits: tuple[set[str], set[str]],
) -> ServiceResponse:
    """Where a person is (`name`), or everyone at home, by name."""
    untold, closed = limits
    people = hass.data.get(PEOPLE_KEY)
    placed = list(people.config["people"]) if people is not None else []
    places = people.places if people is not None else {}
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
                clauses.append(_place_text(said, name, place, closed).removesuffix(said["stop"]))
        return {"people": entries, "text": said["and"].join(clauses) + said["stop"]}
    locator = hass.data.get(LOCATOR_KEY)
    found = _best(_scored_people(hass, asked, placed) + _scored_things(hass, asked))
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
    """Register DomoTwin's actions (once, at integration setup)."""

    async def show(call: ServiceCall) -> None:
        request = {key: value for key, value in call.data.items() if value != ""}
        person = request.pop("person", None)
        if person is not None:
            # A person is shown in their room; nowhere when not placed, or not to be shown.
            people = hass.data.get(PEOPLE_KEY)
            untold, closed = await _limits(hass, call)
            # A workplace (D-086) shows nobody's room.
            if people is None or person in untold or _workplace(hass):
                return
            place = people.places.get(person)
            # Not in a private room either: showing it would tell where they are (D-039).
            if place is None or place.room is None or place.room.id in closed:
                return
            request["room"] = place.room.id
        async_dispatcher_send(hass, SIGNAL_SHOW, request)

    async def where(call: ServiceCall) -> ServiceResponse:
        return await _async_where(hass, call)

    async def schedule(call: ServiceCall) -> ServiceResponse:
        scheduler = hass.data.get(SCHEDULER_KEY)
        if scheduler is None:
            raise HomeAssistantError("DomoTwin is not set up")
        start, end = times(
            call.data.get("at"),
            call.data.get("delay"),
            call.data.get("until"),
            call.data.get("duration"),
        )
        try:
            item = await scheduler.async_add(
                call.data["entity_id"],
                call.data["action"],
                start,
                end,
                call.data.get("brightness"),
                user_id=call.context.user_id,
            )
        except ScheduleError as err:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key=f"schedule_{err.code}"
            ) from err
        return {**item.as_dict(), "text": describe(hass, item)}

    async def unschedule(call: ServiceCall) -> ServiceResponse:
        scheduler = hass.data.get(SCHEDULER_KEY)
        if scheduler is None:
            raise HomeAssistantError("DomoTwin is not set up")
        ids = [call.data["id"]] if "id" in call.data else []
        ids += [item.id for item in scheduler.of_entities(call.data.get("entity_id", []))]
        try:
            return {"cancelled": await scheduler.async_cancel(ids, call.context.user_id)}
        except ScheduleError as err:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key=f"schedule_{err.code}"
            ) from err

    hass.services.async_register(DOMAIN, SERVICE_SHOW, show, schema=SHOW_SCHEMA)
    hass.services.async_register(
        DOMAIN,
        SERVICE_WHERE,
        where,
        schema=WHERE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SCHEDULE,
        schedule,
        schema=SCHEDULE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_UNSCHEDULE,
        unschedule,
        schema=UNSCHEDULE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
