"""The weekly report in words (`docs/DECISIONS.md`, D-066).

In Home Assistant's language (English or French): Home Assistant's notification, and what the AI
task is asked to sum up.

The page in the panel writes the report in each viewer's own language from what is kept; only the
notification and the summary are written once, for the home.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta
import re
from typing import Any, Final

from homeassistant.util import dt as dt_util

from .const import REPORT_SECTIONS

#: The characters Markdown formats or links with.
MARKDOWN: Final = re.compile(r"[\\`*_{}\[\]()<>#+!|~&]")
#: What makes a line a list's item in Markdown, at its start: a dash, or a number and its dot.
BLOCK: Final = re.compile(r"^(\s*)(?:(-)|(\d+)([.)]))")
#: Names listed at most in a line of the notification; the others counted.
MAX_NAMED: Final = 5
#: The order of the sections, in the notification and the summary: the report's.
SECTIONS: Final = REPORT_SECTIONS
#: Sections the notification counts without naming what is in them: Home Assistant shows its
#: notifications to every user, and only administrators may read the automations' traces and the
#: radios.
COUNTED_ONLY: Final = frozenset({"automations", "radios"})

#: What the AI task is asked, in English whatever the language it answers in: models follow
#: English best.
ASK: Final = (
    "You write the weekly report of a home, for the people who look after it. In {language}, in "
    "three to five short sentences of plain text (no lists, no headings, no Markdown), say what "
    "needs a look first and why, then how the energy went. Name the rooms where they are given. "
    "Do not make anything up: say only what the facts below say, and nothing about what is "
    "fine.\n\nThe facts of the week of {start} to {end}:\n{facts}"
)

WORDS: Final[dict[str, dict[str, Any]]] = {
    "en": {
        "title": "DomoTwin · The week's report",
        "week": "The week of {start} to {end}.",
        "nothing": "Nothing needs a look this week.",
        "open": "Open the report",
        "more": "and {count} more",
        "sections": {
            "batteries": ("{count} battery low", "{count} batteries low"),
            "unavailable": ("{count} device unavailable", "{count} devices unavailable"),
            "updates": ("{count} update waiting", "{count} updates waiting"),
            "repairs": ("{count} repair waiting", "{count} repairs waiting"),
            "upkeep": ("{count} upkeep task due", "{count} upkeep tasks due"),
            "automations": ("{count} automation to look at", "{count} automations to look at"),
            "radios": (
                "{count} Zigbee device on a weak link",
                "{count} Zigbee devices on a weak link",
            ),
        },
        "in_report": "in the report",
        "energy": "**Energy**: {used} kWh used",
        "energy_grid": "**Energy**: {used} kWh drawn from the grid",
        "less": ", {change} % less than the week before",
        "more_than": ", {change} % more than the week before",
        "same": ", as much as the week before",
        "peaks": (
            "**{count} Hydro-Québec peak**",
            "**{count} Hydro-Québec peaks**",
        ),
        "peaks_grid": ": {kwh} kWh drawn from the grid during them",
        "level": "{name} ({level} %)",
        "warranty": "{name}: warranty ends {date}",
        "task": "{name}: {task}",
        "months": (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        "day": "{day} {month}",
        "language": "English",
        "fact_room": "{text} (in the {room})",
        "fact_new": "{text}, new this week",
        "facts": {
            "batteries": "Battery low: {text}",
            "unavailable": "Device unavailable since {since}: {text}",
            "updates": "Update waiting: {text}",
            "repairs": "Repair waiting: {text}",
            "upkeep": "Upkeep: {text}",
            "energy": "Energy used by the home: {week} kWh this week, {before} kWh the week before",
            "grid": (
                "Energy drawn from the grid: {week} kWh this week, {before} kWh the week before"
            ),
            "room_energy": (
                "Energy used in the {room}: {week} kWh this week, {before} kWh the week before"
            ),
            "peak": "Hydro-Québec peak from {start} to {end}: {kwh} kWh drawn from the grid",
            "unknown": "unknown",
            "overdue": "{task}, overdue since {due}",
            "due": "{task}, due {due}",
        },
    },
    "fr": {
        "title": "DomoTwin · Le bilan de la semaine",
        "week": "La semaine du {start} au {end}.",
        "nothing": "Rien à surveiller cette semaine.",
        "open": "Ouvrir le bilan",
        "more": "et {count} de plus",
        "sections": {
            "batteries": ("{count} pile faible", "{count} piles faibles"),
            "unavailable": ("{count} appareil indisponible", "{count} appareils indisponibles"),
            "updates": ("{count} mise à jour en attente", "{count} mises à jour en attente"),
            "repairs": ("{count} réparation en attente", "{count} réparations en attente"),
            "upkeep": ("{count} tâche d'entretien à faire", "{count} tâches d'entretien à faire"),
            "automations": ("{count} automatisation à revoir", "{count} automatisations à revoir"),
            "radios": (
                "{count} appareil Zigbee sur un lien faible",
                "{count} appareils Zigbee sur un lien faible",
            ),
        },
        "in_report": "dans le bilan",
        "energy": "**Énergie** : {used} kWh consommés",
        "energy_grid": "**Énergie** : {used} kWh tirés du réseau",
        "less": ", {change} % de moins que la semaine d'avant",
        "more_than": ", {change} % de plus que la semaine d'avant",
        "same": ", autant que la semaine d'avant",
        "peaks": (
            "**{count} pointe d'Hydro-Québec**",
            "**{count} pointes d'Hydro-Québec**",
        ),
        "peaks_grid": " : {kwh} kWh tirés du réseau pendant celles-ci",
        "level": "{name} ({level} %)",
        "warranty": "{name} : garantie jusqu'au {date}",
        "task": "{name} : {task}",
        "months": (
            "janvier",
            "février",
            "mars",
            "avril",
            "mai",
            "juin",
            "juillet",
            "août",
            "septembre",
            "octobre",
            "novembre",
            "décembre",
        ),
        "day": "{day} {month}",
        "language": "French",
        "fact_room": "{text} (pièce : {room})",
        "fact_new": "{text}, nouveau cette semaine",
        "facts": {
            "batteries": "Pile faible : {text}",
            "unavailable": "Appareil indisponible depuis le {since} : {text}",
            "updates": "Mise à jour en attente : {text}",
            "repairs": "Réparation en attente : {text}",
            "upkeep": "Entretien : {text}",
            "energy": (
                "Énergie consommée : {week} kWh cette semaine, {before} kWh la semaine d'avant"
            ),
            "grid": (
                "Énergie tirée du réseau : {week} kWh cette semaine, "
                "{before} kWh la semaine d'avant"
            ),
            "room_energy": (
                "Énergie consommée (pièce : {room}) : {week} kWh cette semaine, "
                "{before} kWh la semaine d'avant"
            ),
            "peak": "Pointe d'Hydro-Québec du {start} au {end} : {kwh} kWh tirés du réseau",
            "unknown": "inconnue",
            "overdue": "{task}, en retard depuis le {due}",
            "due": "{task}, à faire le {due}",
        },
    },
}


def language_of(language: str) -> str:
    """The report's language: French for Home Assistant in French, English otherwise."""
    return "fr" if language.lower().startswith("fr") else "en"


def _number(value: float, language: str, decimals: int = 1) -> str:
    text = f"{value:.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", ",") if language == "fr" else text


def markdown(text: str) -> str:
    """A text as Markdown shows it as it is, on one line: what formats or links escaped."""
    line = MARKDOWN.sub(r"\\\g<0>", " ".join(text.split()))
    match = BLOCK.match(line)
    if match is None:
        return line
    if match.group(2):
        return f"{match.group(1)}\\-{line[match.end() :]}"
    return f"{match.group(1)}{match.group(3)}\\{match.group(4)}{line[match.end() :]}"


def _escaped(item: Mapping[str, Any]) -> dict[str, Any]:
    """An item whose texts (its name, its task) Markdown shows as they are."""
    return {
        **item,
        **{key: markdown(str(item[key])) for key in ("name", "task") if key in item},
    }


def _plural(forms: tuple[str, str], count: int, language: str) -> str:
    # French counts 0 and 1 as one; English only 1.
    one = count in (0, 1) if language == "fr" else count == 1
    return (forms[0] if one else forms[1]).format(count=count)


def day_text(moment: datetime | str, language: str) -> str:
    """A day as people write it, where the home is: "19 October", "19 octobre"."""
    if isinstance(moment, str):
        parsed = dt_util.parse_datetime(moment)
        if parsed is None:
            return moment
        moment = parsed
    local = dt_util.as_local(moment)
    words = WORDS[language]
    return str(words["day"]).format(day=local.day, month=words["months"][local.month - 1])


def time_text(moment: str, language: str) -> str:
    """A moment where the home is: its day and its hour."""
    parsed = dt_util.parse_datetime(moment)
    if parsed is None:
        return moment
    local = dt_util.as_local(parsed)
    hour = (
        f"{local.hour:02d}:{local.minute:02d}"
        if language == "en"
        else f"{local.hour} h {local.minute:02d}"
    )
    return f"{day_text(local, language)}, {hour}"


def week_bounds(report: Mapping[str, Any], language: str) -> tuple[str, str]:
    """The week's first and last days (its end is the midnight after its last day)."""
    week = report["week"]
    start = dt_util.parse_datetime(week["start"])
    end = dt_util.parse_datetime(week["end"])
    if start is None or end is None:
        return week["start"], week["end"]
    # Its end is the midnight after its last day.
    return day_text(start, language), day_text(end - timedelta(seconds=1), language)


def item_text(section: str, item: Mapping[str, Any], language: str) -> str:
    """What an item is, in short."""
    words = WORDS[language]
    name = str(item.get("name", ""))
    if section == "batteries" and "level" in item:
        return str(words["level"]).format(name=name, level=item["level"])
    if section == "upkeep":
        if "warranty_end" in item:
            return str(words["warranty"]).format(name=name, date=item["warranty_end"])
        return str(words["task"]).format(name=name, task=item.get("task", ""))
    return name


def _change(week: float, before: float, language: str) -> str:
    words = WORDS[language]
    if before <= 0:
        return ""
    change = round((week - before) / before * 100)
    if change == 0:
        return str(words["same"])
    key = "more_than" if change > 0 else "less"
    return str(words[key]).format(change=abs(change))


def notification(
    report: Mapping[str, Any], language: str, summary: str | None, link: str | None
) -> tuple[str, str]:
    """Home Assistant's notification of a report: its title and its Markdown.

    With a link to its page in the panel when the panel is there.
    """
    words = WORDS[language]
    start, end = week_bounds(report, language)
    lines: list[str] = [str(words["week"]).format(start=start, end=end)]
    if summary:
        lines += ["", markdown(summary)]
    listed: list[str] = []
    sections: Mapping[str, list[Mapping[str, Any]]] = report.get("sections", {})
    more: Mapping[str, int] = report.get("more", {})
    for section in SECTIONS:
        items = sections.get(section) or []
        count = len(items) + int(more.get(section, 0))
        if count == 0:
            continue
        head = _plural(words["sections"][section], count, language)
        if section in COUNTED_ONLY:
            listed.append(f"- **{head}** ({words['in_report']})")
            continue
        named = [item_text(section, _escaped(item), language) for item in items[:MAX_NAMED]]
        if count > len(named):
            named.append(str(words["more"]).format(count=count - len(named)))
        listed.append(
            f"- **{head}**: {', '.join(named)}"
            if language == "en"
            else f"- **{head}** : {', '.join(named)}"
        )
    energy = report.get("energy") or {}
    used = energy.get("home") or {}
    grid = energy.get("grid") or {}
    shown = used if "week" in used else grid if "week" in grid else None
    if shown is not None:
        key = "energy" if shown is used else "energy_grid"
        line = str(words[key]).format(used=_number(shown["week"], language))
        if "before" in shown:
            line += _change(shown["week"], shown["before"], language)
        listed.append(f"- {line}")
    peaks = report.get("peaks")
    if peaks:
        line = _plural(words["peaks"], len(peaks), language)
        drawn = [peak["grid"] for peak in peaks if "grid" in peak]
        if drawn:
            line += str(words["peaks_grid"]).format(kwh=_number(sum(drawn), language))
        listed.append(f"- {line}")
    if not any(sections.get(section) for section in SECTIONS):
        lines += ["", str(words["nothing"])]
    if listed:
        lines += ["", *listed]
    if link:
        lines += ["", f"[{words['open']}]({link})"]
    return str(words["title"]), "\n".join(lines)


def ask(report: Mapping[str, Any], language: str, rooms: Mapping[str, str]) -> str:
    """What the AI task is asked: the report's facts, and how to sum them up.

    The automations and the radios counted, not named: the summary is written into Home
    Assistant's notification, which every user sees.
    """
    words = WORDS[language]
    said = words["facts"]
    facts: list[str] = []

    def fact(text: str, item: Mapping[str, Any]) -> str:
        room = rooms.get(str(item.get("room", "")))
        if room:
            text = str(words["fact_room"]).format(text=text, room=room)
        if item.get("new"):
            text = str(words["fact_new"]).format(text=text)
        return f"- {text}"

    sections: Mapping[str, list[Mapping[str, Any]]] = report.get("sections", {})
    more: Mapping[str, int] = report.get("more", {})
    for section in SECTIONS:
        items = sections.get(section) or []
        if section in COUNTED_ONLY:
            # Counted, as in the notification the summary is written into.
            count = len(items) + int(more.get(section, 0))
            if count:
                facts.append(f"- {_plural(words['sections'][section], count, language)}")
            continue
        for item in items:
            if section == "unavailable":
                text = str(said[section]).format(
                    text=item.get("name", ""), since=day_text(str(item.get("since", "")), language)
                )
            elif section == "upkeep" and "task" in item:
                state = "overdue" if item.get("state") == "overdue" else "due"
                task = str(said[state]).format(task=item["task"], due=item.get("due", ""))
                text = str(said[section]).format(text=f"{item.get('name', '')}: {task}")
            elif section == "updates" and item.get("latest"):
                version = f"{item.get('installed', '?')} → {item['latest']}"
                text = str(said[section]).format(text=f"{item.get('name', '')} ({version})")
            else:
                text = str(said[section]).format(text=item_text(section, item, language))
            facts.append(fact(text, item))
    energy = report.get("energy") or {}
    unknown = str(said["unknown"])

    def kwh(pair: Mapping[str, Any], key: str) -> str:
        return _number(pair[key], language) if key in pair else unknown

    for key in ("home", "grid"):
        if pair := energy.get(key):
            name = "energy" if key == "home" else "grid"
            facts.append(
                f"- {str(said[name]).format(week=kwh(pair, 'week'), before=kwh(pair, 'before'))}"
            )
    facts.extend(
        "- "
        + str(said["room_energy"]).format(
            room=rooms.get(room, room), week=kwh(pair, "week"), before=kwh(pair, "before")
        )
        for room, pair in sorted((energy.get("rooms") or {}).items())
    )
    facts.extend(
        "- "
        + str(said["peak"]).format(
            start=time_text(peak["start"], language),
            end=time_text(peak["end"], language),
            kwh=_number(peak["grid"], language) if "grid" in peak else unknown,
        )
        for peak in report.get("peaks") or []
    )
    start, end = week_bounds(report, language)
    return ASK.format(
        language=words["language"],
        start=start,
        end=end,
        facts="\n".join(facts) or str(words["nothing"]),
    )
