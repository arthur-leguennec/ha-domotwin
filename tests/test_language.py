"""What the integration says, in every language DomoTwin speaks (D-082)."""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any
from unittest.mock import patch

import pytest

from custom_components.domotwin.language import LANGUAGES, speaks, spoken
from custom_components.domotwin.report_words import WORDS, ask, language_of, notification
from custom_components.domotwin.schedules import _SAID
from custom_components.domotwin.services import SENTENCES
from homeassistant.util import dt as dt_util

ROOT = Path(__file__).parent.parent
TRANSLATIONS = ROOT / "custom_components" / "domotwin" / "translations"


def _placeholders(text: str) -> set[str]:
    return set(re.findall(r"\{(\w+)\}", text))


def _leaves(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        return {
            key: leaf
            for name, child in value.items()
            for key, leaf in _leaves(child, f"{prefix}{name}.").items()
        }
    return {prefix.rstrip("."): value}


def test_home_assistant_languages_are_spoken_as_the_frontend_picks_them() -> None:
    """The same mapping as the frontend's `pickLanguage`."""
    assert spoken("fr-CA") == "fr"
    assert spoken("de") == "de"
    assert spoken("pt") == "pt"
    assert spoken("pt-BR") == "pt-BR"
    assert spoken("pt_br") == "pt-BR"
    assert spoken("zh_Hant_TW") == "zh-Hans"
    assert spoken("zh-Hant") == "zh-Hans"
    assert spoken("sv") == "en"
    assert speaks("sv") is None
    assert speaks("zh-hans") == "zh-Hans"
    assert speaks("en-GB") == "en"
    assert spoken(None) == "en"


def test_the_frontend_speaks_the_same_languages() -> None:
    """`LANGUAGES` here and in `frontend/src/i18n/index.ts`, in the same order."""
    text = (ROOT / "frontend" / "src" / "i18n" / "index.ts").read_text(encoding="utf-8")
    found = re.search(r"export const LANGUAGES = \[(.*?)\] as const;", text, re.DOTALL)
    assert found is not None
    assert tuple(re.findall(r'"([A-Za-z-]+)"', found.group(1))) == LANGUAGES


@pytest.mark.parametrize("said", [SENTENCES, _SAID], ids=["where", "schedules"])
@pytest.mark.parametrize("language", LANGUAGES)
def test_every_language_says_everything(said: dict[str, dict[str, Any]], language: str) -> None:
    """The same keys as English, the same placeholders; a verb's two forms too."""
    english, own = said["en"], said[language]
    assert own.keys() == english.keys()
    for key, text in english.items():
        if isinstance(text, tuple):
            assert isinstance(own[key], tuple), key
            assert len(own[key]) == len(text), key
            assert all(form.strip() for form in own[key]), key
        elif key != "date":
            assert _placeholders(own[key]) == _placeholders(text), key
    if language != "en":
        assert own != english


@pytest.mark.parametrize("language", [code for code in LANGUAGES if code != "en"])
def test_home_assistant_translations_have_every_key(language: str) -> None:
    """`translations/<code>.json` gives every English key, with its placeholders."""
    english = _leaves(json.loads((TRANSLATIONS / "en.json").read_text(encoding="utf-8")))
    own = _leaves(json.loads((TRANSLATIONS / f"{language}.json").read_text(encoding="utf-8")))
    assert own.keys() == english.keys()
    for key, text in english.items():
        assert _placeholders(own[key]) == _placeholders(text), key


def _fields(text: str) -> set[str]:
    """A format's fields, with or without a format spec (`{minute:02d}`)."""
    return set(re.findall(r"\{(\w+)(?::[^{}]*)?\}", text))


@pytest.mark.parametrize("language", LANGUAGES)
def test_the_weekly_report_is_written_in_every_language(language: str) -> None:
    """Its words (D-081) in each language: every key, field and form; a report written whole."""
    english, own = _leaves(WORDS["en"]), _leaves(WORDS[language])
    assert own.keys() == english.keys()
    for key, text in english.items():
        if isinstance(text, tuple):
            assert isinstance(own[key], tuple), key
            assert len(own[key]) == len(text), key
            forms = zip(own[key], text, strict=True)
            assert all(_fields(form) == _fields(first) for form, first in forms), key
        elif isinstance(text, str):
            assert _fields(own[key]) == _fields(text), key
        else:
            assert type(own[key]) is type(text), key
    if language != "en":
        assert own["title"] != english["title"]
        assert own["months"] != english["months"]
    report: dict[str, Any] = {
        "id": 1,
        "week": {"start": "2026-10-19T04:00:00+00:00", "end": "2026-10-26T04:00:00+00:00"},
        "sections": {
            "batteries": [{"key": "b", "name": "Hall sensor", "level": 9, "room": "hall"}],
            "unavailable": [{"key": "d", "name": "Plug", "since": "2026-10-20T10:00:00+00:00"}],
            "upkeep": [{"key": "w", "name": "Washer", "task": "Filter", "due": "2026-10-20"}],
            "radios": [{"key": "r", "name": "Bulb", "lqi": 40}],
        },
        "more": {"batteries": 1},
        "energy": {"home": {"week": 90.5, "before": 100}, "rooms": {"hall": {"week": 4.5}}},
        "peaks": [
            {"start": "2026-10-20T10:00:00+00:00", "end": "2026-10-20T13:00:00+00:00", "grid": 1.5}
        ],
    }
    with patch.object(dt_util, "DEFAULT_TIME_ZONE", dt_util.get_time_zone("America/Toronto")):
        title, message = notification(report, language, None, "/domotwin?report=1")
        question = ask(report, language, {"hall": "Hall"})
    assert title == WORDS[language]["title"]
    for text in (message, question):
        assert "{" not in text
        assert "}" not in text
    assert "Hall sensor" in message
    assert f"90{WORDS[language]['decimal']}5" in message
    assert str(WORDS[language]["language"]) in question


def test_the_weekly_report_speaks_home_assistant_s_language() -> None:
    """As the frontend picks it: the same language, else without its region, else English."""
    assert language_of("de-CH") == "de"
    assert language_of("pt-BR") == "pt-BR"
    assert language_of("zh-Hant") == "zh-Hans"
    assert language_of("sv") == "en"
