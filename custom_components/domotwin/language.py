"""The language DomoTwin speaks for Home Assistant's (D-082), as its frontend picks it."""

from __future__ import annotations

from typing import Final

#: The languages DomoTwin speaks, as Home Assistant names them.
LANGUAGES: Final = ("en", "fr", "de", "es", "it", "nl", "pt", "pt-BR", "ar", "zh-Hans", "ja", "ko")


def speaks(language: str | None) -> str | None:
    """Home Assistant's language as DomoTwin speaks it, None when it does not.

    The same, else the same without its region (Portuguese is Portugal's, Brazil's has its own;
    every Chinese is simplified).
    """
    code = (language or "en").lower().replace("_", "-")
    for known in LANGUAGES:
        if known.lower() == code:
            return known
    if code.startswith("zh"):
        return "zh-Hans"
    base = code.split("-")[0]
    return base if base in LANGUAGES else None


def spoken(language: str | None) -> str:
    """Home Assistant's language as DomoTwin speaks it, English when it speaks another."""
    return speaks(language) or "en"
