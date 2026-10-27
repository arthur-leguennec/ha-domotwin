"""The weekly report in words (`docs/DECISIONS.md`, D-081).

In Home Assistant's language, as DomoTwin speaks it (D-082): Home Assistant's notification, and
what the AI task is asked to sum up.

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
from .language import spoken

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
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ".",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
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
        "clock": "{hour} h {minute:02d}",
        "decimal": ",",
        "zero_is_one": True,
        "colon": " : ",
        "comma": ", ",
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
    "de": {
        "title": "DomoTwin · Der Wochenbericht",
        "week": "Die Woche vom {start} bis zum {end}.",
        "nothing": "Diese Woche gibt es nichts zu prüfen.",
        "open": "Bericht öffnen",
        "more": "und {count} weitere",
        "sections": {
            "batteries": ("{count} Batterie schwach", "{count} Batterien schwach"),
            "unavailable": ("{count} Gerät nicht verfügbar", "{count} Geräte nicht verfügbar"),
            "updates": ("{count} Update ausstehend", "{count} Updates ausstehend"),
            "repairs": ("{count} Reparatur ausstehend", "{count} Reparaturen ausstehend"),
            "upkeep": ("{count} Wartungsaufgabe fällig", "{count} Wartungsaufgaben fällig"),
            "automations": (
                "{count} Automatisierung zu prüfen",
                "{count} Automatisierungen zu prüfen",
            ),
            "radios": (
                "{count} Zigbee-Gerät mit schwacher Verbindung",
                "{count} Zigbee-Geräte mit schwacher Verbindung",
            ),
        },
        "in_report": "im Bericht",
        "energy": "**Energie**: {used} kWh verbraucht",
        "energy_grid": "**Energie**: {used} kWh aus dem Netz bezogen",
        "less": ", {change} % weniger als in der Woche davor",
        "more_than": ", {change} % mehr als in der Woche davor",
        "same": ", so viel wie in der Woche davor",
        "peaks": (
            "**{count} Hydro-Québec-Spitze**",
            "**{count} Hydro-Québec-Spitzen**",
        ),
        "peaks_grid": ": {kwh} kWh währenddessen aus dem Netz bezogen",
        "level": "{name} ({level} %)",
        "warranty": "{name}: Garantie endet am {date}",
        "task": "{name}: {task}",
        "months": (
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ),
        "day": "{day}. {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ",",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
        "language": "German",
        "fact_room": "{text} (Raum: {room})",
        "fact_new": "{text}, neu diese Woche",
        "facts": {
            "batteries": "Batterie schwach: {text}",
            "unavailable": "Gerät nicht verfügbar seit dem {since}: {text}",
            "updates": "Update ausstehend: {text}",
            "repairs": "Reparatur ausstehend: {text}",
            "upkeep": "Wartung: {text}",
            "energy": (
                "Vom Zuhause verbrauchte Energie: {week} kWh diese Woche, "
                "{before} kWh in der Woche davor"
            ),
            "grid": (
                "Aus dem Netz bezogene Energie: {week} kWh diese Woche, "
                "{before} kWh in der Woche davor"
            ),
            "room_energy": (
                "Im Raum {room} verbrauchte Energie: {week} kWh diese Woche, "
                "{before} kWh in der Woche davor"
            ),
            "peak": "Hydro-Québec-Spitze vom {start} bis {end}: {kwh} kWh aus dem Netz bezogen",
            "unknown": "unbekannt",
            "overdue": "{task}, überfällig seit dem {due}",
            "due": "{task}, fällig am {due}",
        },
    },
    "es": {
        "title": "DomoTwin · El informe de la semana",
        "week": "La semana del {start} al {end}.",
        "nothing": "Nada que revisar esta semana.",
        "open": "Abrir el informe",
        "more": "y {count} más",
        "sections": {
            "batteries": ("{count} batería baja", "{count} baterías bajas"),
            "unavailable": (
                "{count} dispositivo no disponible",
                "{count} dispositivos no disponibles",
            ),
            "updates": ("{count} actualización pendiente", "{count} actualizaciones pendientes"),
            "repairs": ("{count} reparación pendiente", "{count} reparaciones pendientes"),
            "upkeep": (
                "{count} tarea de mantenimiento pendiente",
                "{count} tareas de mantenimiento pendientes",
            ),
            "automations": (
                "{count} automatización por revisar",
                "{count} automatizaciones por revisar",
            ),
            "radios": (
                "{count} dispositivo Zigbee con un enlace débil",
                "{count} dispositivos Zigbee con un enlace débil",
            ),
        },
        "in_report": "en el informe",
        "energy": "**Energía**: {used} kWh consumidos",
        "energy_grid": "**Energía**: {used} kWh consumidos de la red",
        "less": ", un {change} % menos que la semana anterior",
        "more_than": ", un {change} % más que la semana anterior",
        "same": ", lo mismo que la semana anterior",
        "peaks": (
            "**{count} pico de Hydro-Québec**",
            "**{count} picos de Hydro-Québec**",
        ),
        "peaks_grid": ": {kwh} kWh consumidos de la red durante ese tiempo",
        "level": "{name} ({level} %)",
        "warranty": "{name}: la garantía termina el {date}",
        "task": "{name}: {task}",
        "months": (
            "enero",
            "febrero",
            "marzo",
            "abril",
            "mayo",
            "junio",
            "julio",
            "agosto",
            "septiembre",
            "octubre",
            "noviembre",
            "diciembre",
        ),
        "day": "{day} de {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ",",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
        "language": "Spanish",
        "fact_room": "{text} (habitación: {room})",
        "fact_new": "{text}, nuevo esta semana",
        "facts": {
            "batteries": "Batería baja: {text}",
            "unavailable": "Dispositivo no disponible desde el {since}: {text}",
            "updates": "Actualización pendiente: {text}",
            "repairs": "Reparación pendiente: {text}",
            "upkeep": "Mantenimiento: {text}",
            "energy": (
                "Energía consumida por la casa: {week} kWh esta semana, "
                "{before} kWh la semana anterior"
            ),
            "grid": (
                "Energía consumida de la red: {week} kWh esta semana, "
                "{before} kWh la semana anterior"
            ),
            "room_energy": (
                "Energía consumida (habitación: {room}): {week} kWh esta semana, "
                "{before} kWh la semana anterior"
            ),
            "peak": "Pico de Hydro-Québec del {start} al {end}: {kwh} kWh consumidos de la red",
            "unknown": "desconocida",
            "overdue": "{task}, con retraso desde el {due}",
            "due": "{task}, para el {due}",
        },
    },
    "it": {
        "title": "DomoTwin · Il resoconto della settimana",
        "week": "La settimana dal {start} al {end}.",
        "nothing": "Niente da controllare questa settimana.",
        "open": "Apri il resoconto",
        "more": "e altri {count}",
        "sections": {
            "batteries": ("{count} batteria scarica", "{count} batterie scariche"),
            "unavailable": (
                "{count} dispositivo non disponibile",
                "{count} dispositivi non disponibili",
            ),
            "updates": ("{count} aggiornamento in attesa", "{count} aggiornamenti in attesa"),
            "repairs": ("{count} riparazione in attesa", "{count} riparazioni in attesa"),
            "upkeep": (
                "{count} attività di manutenzione da fare",
                "{count} attività di manutenzione da fare",
            ),
            "automations": (
                "{count} automazione da controllare",
                "{count} automazioni da controllare",
            ),
            "radios": (
                "{count} dispositivo Zigbee su un collegamento debole",
                "{count} dispositivi Zigbee su un collegamento debole",
            ),
        },
        "in_report": "nel resoconto",
        "energy": "**Energia**: {used} kWh consumati",
        "energy_grid": "**Energia**: {used} kWh prelevati dalla rete",
        "less": ", {change} % in meno rispetto alla settimana prima",
        "more_than": ", {change} % in più rispetto alla settimana prima",
        "same": ", quanto la settimana prima",
        "peaks": (
            "**{count} picco di Hydro-Québec**",
            "**{count} picchi di Hydro-Québec**",
        ),
        "peaks_grid": ": {kwh} kWh prelevati dalla rete in quelle ore",
        "level": "{name} ({level} %)",
        "warranty": "{name}: la garanzia scade il {date}",
        "task": "{name}: {task}",
        "months": (
            "gennaio",
            "febbraio",
            "marzo",
            "aprile",
            "maggio",
            "giugno",
            "luglio",
            "agosto",
            "settembre",
            "ottobre",
            "novembre",
            "dicembre",
        ),
        "day": "{day} {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ",",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
        "language": "Italian",
        "fact_room": "{text} (stanza: {room})",
        "fact_new": "{text}, nuovo questa settimana",
        "facts": {
            "batteries": "Batteria scarica: {text}",
            "unavailable": "Dispositivo non disponibile dal {since}: {text}",
            "updates": "Aggiornamento in attesa: {text}",
            "repairs": "Riparazione in attesa: {text}",
            "upkeep": "Manutenzione: {text}",
            "energy": (
                "Energia consumata dalla casa: {week} kWh questa settimana, "
                "{before} kWh la settimana prima"
            ),
            "grid": (
                "Energia prelevata dalla rete: {week} kWh questa settimana, "
                "{before} kWh la settimana prima"
            ),
            "room_energy": (
                "Energia consumata (stanza: {room}): {week} kWh questa settimana, "
                "{before} kWh la settimana prima"
            ),
            "peak": "Picco di Hydro-Québec dal {start} al {end}: {kwh} kWh prelevati dalla rete",
            "unknown": "sconosciuta",
            "overdue": "{task}, in ritardo dal {due}",
            "due": "{task}, da fare il {due}",
        },
    },
    "nl": {
        "title": "DomoTwin · Het weekverslag",
        "week": "De week van {start} tot en met {end}.",
        "nothing": "Deze week hoeft er niets nagekeken te worden.",
        "open": "Verslag openen",
        "more": "en nog {count}",
        "sections": {
            "batteries": ("{count} batterij bijna leeg", "{count} batterijen bijna leeg"),
            "unavailable": (
                "{count} apparaat niet beschikbaar",
                "{count} apparaten niet beschikbaar",
            ),
            "updates": ("{count} update wacht", "{count} updates wachten"),
            "repairs": ("{count} reparatie wacht", "{count} reparaties wachten"),
            "upkeep": ("{count} onderhoudstaak te doen", "{count} onderhoudstaken te doen"),
            "automations": (
                "{count} automatisering om na te kijken",
                "{count} automatiseringen om na te kijken",
            ),
            "radios": (
                "{count} Zigbee-apparaat met een zwakke verbinding",
                "{count} Zigbee-apparaten met een zwakke verbinding",
            ),
        },
        "in_report": "in het verslag",
        "energy": "**Energie**: {used} kWh verbruikt",
        "energy_grid": "**Energie**: {used} kWh van het net afgenomen",
        "less": ", {change} % minder dan de week ervoor",
        "more_than": ", {change} % meer dan de week ervoor",
        "same": ", evenveel als de week ervoor",
        "peaks": (
            "**{count} piek van Hydro-Québec**",
            "**{count} pieken van Hydro-Québec**",
        ),
        "peaks_grid": ": {kwh} kWh van het net afgenomen in die tijd",
        "level": "{name} ({level} %)",
        "warranty": "{name}: garantie loopt af op {date}",
        "task": "{name}: {task}",
        "months": (
            "januari",
            "februari",
            "maart",
            "april",
            "mei",
            "juni",
            "juli",
            "augustus",
            "september",
            "oktober",
            "november",
            "december",
        ),
        "day": "{day} {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ",",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
        "language": "Dutch",
        "fact_room": "{text} (kamer: {room})",
        "fact_new": "{text}, nieuw deze week",
        "facts": {
            "batteries": "Batterij bijna leeg: {text}",
            "unavailable": "Apparaat niet beschikbaar sinds {since}: {text}",
            "updates": "Update wacht: {text}",
            "repairs": "Reparatie wacht: {text}",
            "upkeep": "Onderhoud: {text}",
            "energy": (
                "Energie verbruikt door het huis: {week} kWh deze week, {before} kWh de week ervoor"
            ),
            "grid": (
                "Energie van het net afgenomen: {week} kWh deze week, {before} kWh de week ervoor"
            ),
            "room_energy": (
                "Energie verbruikt (kamer: {room}): {week} kWh deze week, "
                "{before} kWh de week ervoor"
            ),
            "peak": "Piek van Hydro-Québec van {start} tot {end}: {kwh} kWh van het net afgenomen",
            "unknown": "onbekend",
            "overdue": "{task}, achterstallig sinds {due}",
            "due": "{task}, te doen op {due}",
        },
    },
    "pt": {
        "title": "DomoTwin · O relatório da semana",
        "week": "A semana de {start} a {end}.",
        "nothing": "Nada precisa de atenção esta semana.",
        "open": "Abrir o relatório",
        "more": "e mais {count}",
        "sections": {
            "batteries": ("{count} bateria fraca", "{count} baterias fracas"),
            "unavailable": (
                "{count} dispositivo indisponível",
                "{count} dispositivos indisponíveis",
            ),
            "updates": ("{count} atualização pendente", "{count} atualizações pendentes"),
            "repairs": ("{count} reparação pendente", "{count} reparações pendentes"),
            "upkeep": (
                "{count} tarefa de manutenção a fazer",
                "{count} tarefas de manutenção a fazer",
            ),
            "automations": ("{count} automatização a rever", "{count} automatizações a rever"),
            "radios": (
                "{count} dispositivo Zigbee numa ligação fraca",
                "{count} dispositivos Zigbee numa ligação fraca",
            ),
        },
        "in_report": "no relatório",
        "energy": "**Energia**: {used} kWh consumidos",
        "energy_grid": "**Energia**: {used} kWh retirados da rede",
        "less": ", menos {change} % do que na semana anterior",
        "more_than": ", mais {change} % do que na semana anterior",
        "same": ", tanto como na semana anterior",
        "peaks": (
            "**{count} pico da Hydro-Québec**",
            "**{count} picos da Hydro-Québec**",
        ),
        "peaks_grid": ": {kwh} kWh retirados da rede em período de pico",
        "level": "{name} ({level} %)",
        "warranty": "{name}: garantia até {date}",
        "task": "{name}: {task}",
        "months": (
            "janeiro",
            "fevereiro",
            "março",
            "abril",
            "maio",
            "junho",
            "julho",
            "agosto",
            "setembro",
            "outubro",
            "novembro",
            "dezembro",
        ),
        "day": "{day} de {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ",",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
        "language": "European Portuguese",
        "fact_room": "{text} (divisão: {room})",
        "fact_new": "{text}, novidade desta semana",
        "facts": {
            "batteries": "Bateria fraca: {text}",
            "unavailable": "Dispositivo indisponível desde {since}: {text}",
            "updates": "Atualização pendente: {text}",
            "repairs": "Reparação pendente: {text}",
            "upkeep": "Manutenção: {text}",
            "energy": (
                "Energia consumida pela casa: {week} kWh esta semana, "
                "{before} kWh na semana anterior"
            ),
            "grid": (
                "Energia retirada da rede: {week} kWh esta semana, {before} kWh na semana anterior"
            ),
            "room_energy": (
                "Energia consumida (divisão: {room}): {week} kWh esta semana, "
                "{before} kWh na semana anterior"
            ),
            "peak": "Pico da Hydro-Québec de {start} a {end}: {kwh} kWh retirados da rede",
            "unknown": "uma quantidade desconhecida de",
            "overdue": "{task}, em atraso desde {due}",
            "due": "{task}, para {due}",
        },
    },
    "pt-BR": {
        "title": "DomoTwin · O relatório da semana",
        "week": "A semana de {start} a {end}.",
        "nothing": "Nada precisa de atenção nesta semana.",
        "open": "Abrir o relatório",
        "more": "e mais {count}",
        "sections": {
            "batteries": ("{count} bateria fraca", "{count} baterias fracas"),
            "unavailable": (
                "{count} dispositivo indisponível",
                "{count} dispositivos indisponíveis",
            ),
            "updates": ("{count} atualização pendente", "{count} atualizações pendentes"),
            "repairs": ("{count} reparo pendente", "{count} reparos pendentes"),
            "upkeep": (
                "{count} tarefa de manutenção a fazer",
                "{count} tarefas de manutenção a fazer",
            ),
            "automations": ("{count} automação para revisar", "{count} automações para revisar"),
            "radios": (
                "{count} dispositivo Zigbee em uma conexão fraca",
                "{count} dispositivos Zigbee em uma conexão fraca",
            ),
        },
        "in_report": "no relatório",
        "energy": "**Energia**: {used} kWh consumidos",
        "energy_grid": "**Energia**: {used} kWh retirados da rede",
        "less": ", {change} % a menos que na semana anterior",
        "more_than": ", {change} % a mais que na semana anterior",
        "same": ", tanto quanto na semana anterior",
        "peaks": (
            "**{count} pico da Hydro-Québec**",
            "**{count} picos da Hydro-Québec**",
        ),
        "peaks_grid": ": {kwh} kWh retirados da rede em horário de pico",
        "level": "{name} ({level} %)",
        "warranty": "{name}: garantia até {date}",
        "task": "{name}: {task}",
        "months": (
            "janeiro",
            "fevereiro",
            "março",
            "abril",
            "maio",
            "junho",
            "julho",
            "agosto",
            "setembro",
            "outubro",
            "novembro",
            "dezembro",
        ),
        "day": "{day} de {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ",",
        "zero_is_one": True,
        "colon": ": ",
        "comma": ", ",
        "language": "Brazilian Portuguese",
        "fact_room": "{text} (cômodo: {room})",
        "fact_new": "{text}, novidade desta semana",
        "facts": {
            "batteries": "Bateria fraca: {text}",
            "unavailable": "Dispositivo indisponível desde {since}: {text}",
            "updates": "Atualização pendente: {text}",
            "repairs": "Reparo pendente: {text}",
            "upkeep": "Manutenção: {text}",
            "energy": (
                "Energia consumida pela casa: {week} kWh nesta semana, "
                "{before} kWh na semana anterior"
            ),
            "grid": (
                "Energia retirada da rede: {week} kWh nesta semana, {before} kWh na semana anterior"
            ),
            "room_energy": (
                "Energia consumida (cômodo: {room}): {week} kWh nesta semana, "
                "{before} kWh na semana anterior"
            ),
            "peak": "Pico da Hydro-Québec de {start} a {end}: {kwh} kWh retirados da rede",
            "unknown": "uma quantidade desconhecida de",
            "overdue": "{task}, atrasada desde {due}",
            "due": "{task}, vence em {due}",
        },
    },
    "ar": {
        "title": "DomoTwin · تقرير الأسبوع",
        "week": "الأسبوع من {start} إلى {end}.",
        "nothing": "لا شيء يحتاج إلى انتباه هذا الأسبوع.",
        "open": "فتح التقرير",
        "more": "و{count} أخرى",
        "sections": {
            "batteries": ("بطاريات منخفضة ({count})", "بطاريات منخفضة ({count})"),
            "unavailable": ("أجهزة غير متاحة ({count})", "أجهزة غير متاحة ({count})"),
            "updates": ("تحديثات معلّقة ({count})", "تحديثات معلّقة ({count})"),
            "repairs": ("إصلاحات معلّقة ({count})", "إصلاحات معلّقة ({count})"),
            "upkeep": ("مهام صيانة مستحقة ({count})", "مهام صيانة مستحقة ({count})"),
            "automations": (
                "أتمتة تحتاج إلى مراجعة ({count})",
                "أتمتة تحتاج إلى مراجعة ({count})",
            ),
            "radios": (
                "أجهزة Zigbee على رابط ضعيف ({count})",
                "أجهزة Zigbee على رابط ضعيف ({count})",
            ),
        },
        "in_report": "في التقرير",
        "energy": "**الطاقة**: استهلاك {used} kWh",
        "energy_grid": "**الطاقة**: سحب {used} kWh من الشبكة",
        "less": "، أقل بنسبة {change} % من الأسبوع السابق",
        "more_than": "، أكثر بنسبة {change} % من الأسبوع السابق",
        "same": "، مثل الأسبوع السابق",
        "peaks": (
            "**فترات ذروة Hydro-Québec ({count})**",
            "**فترات ذروة Hydro-Québec ({count})**",
        ),
        "peaks_grid": ": {kwh} kWh مسحوبة من الشبكة خلالها",
        "level": "{name} ({level} %)",
        "warranty": "{name}: ينتهي الضمان في {date}",
        "task": "{name}: {task}",
        "months": (
            "يناير",
            "فبراير",
            "مارس",
            "أبريل",
            "مايو",
            "يونيو",
            "يوليو",
            "أغسطس",
            "سبتمبر",
            "أكتوبر",
            "نوفمبر",
            "ديسمبر",
        ),
        "day": "{day} {month}",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ".",
        "zero_is_one": False,
        "colon": ": ",
        "comma": "، ",
        "language": "Arabic",
        "fact_room": "{text} (في {room})",
        "fact_new": "{text}، جديد هذا الأسبوع",
        "facts": {
            "batteries": "بطارية منخفضة: {text}",
            "unavailable": "جهاز غير متاح منذ {since}: {text}",
            "updates": "تحديث معلّق: {text}",
            "repairs": "إصلاح معلّق: {text}",
            "upkeep": "صيانة: {text}",
            "energy": (
                "الطاقة التي استهلكها المنزل: {week} kWh هذا الأسبوع، "
                "و{before} kWh في الأسبوع السابق"
            ),
            "grid": (
                "الطاقة المسحوبة من الشبكة: {week} kWh هذا الأسبوع، و{before} kWh في الأسبوع السابق"
            ),
            "room_energy": (
                "الطاقة المستهلكة في {room}: {week} kWh هذا الأسبوع، "
                "و{before} kWh في الأسبوع السابق"
            ),
            "peak": "ذروة Hydro-Québec من {start} إلى {end}: {kwh} kWh مسحوبة من الشبكة",
            "unknown": "كمية غير معروفة من",
            "overdue": "{task}، متأخرة منذ {due}",
            "due": "{task}، مستحقة في {due}",
        },
    },
    "zh-Hans": {
        "title": "DomoTwin · 每周报告",
        "week": "{start} 至 {end} 的一周。",
        "nothing": "本周没有需要关注的事项。",
        "open": "打开报告",
        "more": "另有 {count} 项",
        "sections": {
            "batteries": ("{count} 个电池电量低", "{count} 个电池电量低"),
            "unavailable": ("{count} 个设备不可用", "{count} 个设备不可用"),
            "updates": ("{count} 个更新待安装", "{count} 个更新待安装"),
            "repairs": ("{count} 个待修复的问题", "{count} 个待修复的问题"),
            "upkeep": ("{count} 项保养任务到期", "{count} 项保养任务到期"),
            "automations": ("{count} 个自动化需要检查", "{count} 个自动化需要检查"),
            "radios": (
                "{count} 个 Zigbee 设备处于弱连接",
                "{count} 个 Zigbee 设备处于弱连接",
            ),
        },
        "in_report": "详见报告",
        "energy": "**能源**\uff1a用电 {used} kWh",
        "energy_grid": "**能源**\uff1a从电网取用 {used} kWh",
        "less": "\uff0c比上周少 {change} %",
        "more_than": "\uff0c比上周多 {change} %",
        "same": "\uff0c与上周持平",
        "peaks": (
            "**{count} 次 Hydro-Québec 用电高峰**",
            "**{count} 次 Hydro-Québec 用电高峰**",
        ),
        "peaks_grid": "\uff1a期间从电网取用 {kwh} kWh",
        "level": "{name}\uff08{level} %\uff09",
        "warranty": "{name}\uff1a保修于 {date} 到期",
        "task": "{name}\uff1a{task}",
        "months": (
            "1月",
            "2月",
            "3月",
            "4月",
            "5月",
            "6月",
            "7月",
            "8月",
            "9月",
            "10月",
            "11月",
            "12月",
        ),
        "day": "{month}{day}日",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ".",
        "zero_is_one": False,
        "colon": "\uff1a",
        "comma": "、",
        "language": "Simplified Chinese",
        "fact_room": "{text}\uff08位于 {room}\uff09",
        "fact_new": "{text}\uff0c本周新出现",
        "facts": {
            "batteries": "电池电量低\uff1a{text}",
            "unavailable": "自 {since} 起不可用的设备\uff1a{text}",
            "updates": "待安装的更新\uff1a{text}",
            "repairs": "待修复的问题\uff1a{text}",
            "upkeep": "保养\uff1a{text}",
            "energy": "全屋用电\uff1a本周 {week} kWh\uff0c上周 {before} kWh",
            "grid": "从电网取用的电能\uff1a本周 {week} kWh\uff0c上周 {before} kWh",
            "room_energy": "{room} 的用电\uff1a本周 {week} kWh\uff0c上周 {before} kWh",
            "peak": "Hydro-Québec 用电高峰\uff0c{start} 至 {end}\uff1a从电网取用 {kwh} kWh",
            "unknown": "未知",
            "overdue": "{task}\uff0c自 {due} 起已逾期",
            "due": "{task}\uff0c{due} 到期",
        },
    },
    "ja": {
        "title": "DomoTwin · 週間レポート",
        "week": "{start}〜{end} の週。",
        "nothing": "今週は確認が必要なものはありません。",
        "open": "レポートを開く",
        "more": "ほか {count} 件",
        "sections": {
            "batteries": ("{count} 件のバッテリー残量低下", "{count} 件のバッテリー残量低下"),
            "unavailable": ("{count} 台のデバイスが利用不可", "{count} 台のデバイスが利用不可"),
            "updates": ("{count} 件のアップデートが保留中", "{count} 件のアップデートが保留中"),
            "repairs": ("{count} 件の修理が未対応", "{count} 件の修理が未対応"),
            "upkeep": (
                "{count} 件のメンテナンスタスクが期限",
                "{count} 件のメンテナンスタスクが期限",
            ),
            "automations": (
                "{count} 件のオートメーションが要確認",
                "{count} 件のオートメーションが要確認",
            ),
            "radios": (
                "{count} 台の Zigbee デバイスが弱いリンク上",
                "{count} 台の Zigbee デバイスが弱いリンク上",
            ),
        },
        "in_report": "レポートを参照",
        "energy": "**エネルギー**\uff1a{used} kWh を消費",
        "energy_grid": "**エネルギー**\uff1aグリッドから {used} kWh",
        "less": "、前週より {change} % 減少",
        "more_than": "、前週より {change} % 増加",
        "same": "、前週と同じ",
        "peaks": (
            "**Hydro-Québec のピーク {count} 回**",
            "**Hydro-Québec のピーク {count} 回**",
        ),
        "peaks_grid": "\uff1aその間にグリッドから {kwh} kWh",
        "level": "{name}\uff08{level} %\uff09",
        "warranty": "{name}\uff1a保証は {date} まで",
        "task": "{name}\uff1a{task}",
        "months": (
            "1月",
            "2月",
            "3月",
            "4月",
            "5月",
            "6月",
            "7月",
            "8月",
            "9月",
            "10月",
            "11月",
            "12月",
        ),
        "day": "{month}{day}日",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ".",
        "zero_is_one": False,
        "colon": "\uff1a",
        "comma": "、",
        "language": "Japanese",
        "fact_room": "{text}\uff08場所\uff1a{room}\uff09",
        "fact_new": "{text}、今週新たに発生",
        "facts": {
            "batteries": "バッテリー残量低下\uff1a{text}",
            "unavailable": "{since} から利用不可のデバイス\uff1a{text}",
            "updates": "保留中のアップデート\uff1a{text}",
            "repairs": "未対応の修理\uff1a{text}",
            "upkeep": "メンテナンス\uff1a{text}",
            "energy": "家全体の消費エネルギー\uff1a今週 {week} kWh、前週 {before} kWh",
            "grid": "グリッドから供給されたエネルギー\uff1a今週 {week} kWh、前週 {before} kWh",
            "room_energy": "{room} の消費エネルギー\uff1a今週 {week} kWh、前週 {before} kWh",
            "peak": "Hydro-Québec のピーク\uff08{start}〜{end}\uff09\uff1aグリッドから {kwh} kWh",
            "unknown": "不明",
            "overdue": "{task}、{due} から期限切れ",
            "due": "{task}、期限は {due}",
        },
    },
    "ko": {
        "title": "DomoTwin · 주간 보고서",
        "week": "{start}~{end} 주간.",
        "nothing": "이번 주에는 살펴볼 것이 없습니다.",
        "open": "보고서 열기",
        "more": "외 {count}개",
        "sections": {
            "batteries": ("배터리 부족 {count}개", "배터리 부족 {count}개"),
            "unavailable": ("사용 불가 기기 {count}개", "사용 불가 기기 {count}개"),
            "updates": ("대기 중인 업데이트 {count}개", "대기 중인 업데이트 {count}개"),
            "repairs": ("대기 중인 수리 {count}개", "대기 중인 수리 {count}개"),
            "upkeep": ("예정된 관리 작업 {count}개", "예정된 관리 작업 {count}개"),
            "automations": ("확인할 자동화 {count}개", "확인할 자동화 {count}개"),
            "radios": (
                "약한 링크에 있는 Zigbee 기기 {count}개",
                "약한 링크에 있는 Zigbee 기기 {count}개",
            ),
        },
        "in_report": "보고서 참조",
        "energy": "**에너지**: {used} kWh 사용",
        "energy_grid": "**에너지**: 전력망에서 {used} kWh 사용",
        "less": ", 지난주보다 {change}% 적음",
        "more_than": ", 지난주보다 {change}% 많음",
        "same": ", 지난주와 같음",
        "peaks": (
            "**Hydro-Québec 피크 {count}회**",
            "**Hydro-Québec 피크 {count}회**",
        ),
        "peaks_grid": ": 피크 동안 전력망에서 {kwh} kWh 사용",
        "level": "{name} ({level}%)",
        "warranty": "{name}: {date} 보증 만료",
        "task": "{name}: {task}",
        "months": (
            "1월",
            "2월",
            "3월",
            "4월",
            "5월",
            "6월",
            "7월",
            "8월",
            "9월",
            "10월",
            "11월",
            "12월",
        ),
        "day": "{month} {day}일",
        "clock": "{hour:02d}:{minute:02d}",
        "decimal": ".",
        "zero_is_one": False,
        "colon": ": ",
        "comma": ", ",
        "language": "Korean",
        "fact_room": "{text} (위치: {room})",
        "fact_new": "{text}, 이번 주 새로 생김",
        "facts": {
            "batteries": "배터리 부족: {text}",
            "unavailable": "{since}부터 사용 불가인 기기: {text}",
            "updates": "대기 중인 업데이트: {text}",
            "repairs": "대기 중인 수리: {text}",
            "upkeep": "유지 관리: {text}",
            "energy": "집 전체 에너지 사용량: 이번 주 {week} kWh, 지난주 {before} kWh",
            "grid": "전력망에서 받은 에너지: 이번 주 {week} kWh, 지난주 {before} kWh",
            "room_energy": "{room} 에너지 사용량: 이번 주 {week} kWh, 지난주 {before} kWh",
            "peak": "Hydro-Québec 피크 {start}~{end}: 전력망에서 {kwh} kWh",
            "unknown": "알 수 없음",
            "overdue": "{task}, {due}부터 기한 지남",
            "due": "{task}, {due} 예정",
        },
    },
}


def language_of(language: str) -> str:
    """The report's language: Home Assistant's as DomoTwin speaks it, else English."""
    return spoken(language)


def _number(value: float, language: str, decimals: int = 1) -> str:
    text = f"{value:.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", str(WORDS[language]["decimal"]))


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
    # French and Brazilian Portuguese count 0 and 1 as one; the others only 1. A language without
    # plurals, or whose forms are more than two (Arabic), says both alike.
    one = count == 1 or (count == 0 and bool(WORDS[language]["zero_is_one"]))
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
    hour = str(WORDS[language]["clock"]).format(hour=local.hour, minute=local.minute)
    return f"{day_text(local, language)}{WORDS[language]['comma']}{hour}"


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
        listed.append(f"- **{head}**{words['colon']}{str(words['comma']).join(named)}")
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
    Assistant's notification, which every user sees. Only the rooms in `rooms` (their names, by
    id) are said: a private room is not.
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
                text = str(said[section]).format(
                    text=f"{item.get('name', '')}{words['colon']}{task}"
                )
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
            room=rooms[room], week=kwh(pair, "week"), before=kwh(pair, "before")
        )
        for room, pair in sorted((energy.get("rooms") or {}).items())
        if room in rooms
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
