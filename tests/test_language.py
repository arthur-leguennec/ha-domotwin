"""What the integration says, in every language DomoTwin speaks (D-081)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from custom_components.domotwin.language import LANGUAGES, spoken
from custom_components.domotwin.schedules import _SAID
from custom_components.domotwin.services import SENTENCES

TRANSLATIONS = Path(__file__).parent.parent / "custom_components" / "domotwin" / "translations"


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
    assert spoken("zh-Hant") == "zh-Hans"
    assert spoken("sv") == "en"
    assert spoken(None) == "en"


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
