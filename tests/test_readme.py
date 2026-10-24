"""The READMEs work where HACS shows them, inside Home Assistant: no relative paths."""

from __future__ import annotations

import re

import pytest

from .conftest import ROOT

READMES = ["README.md", "README.fr.md"]
REPOSITORY = "https://github.com/arthur-leguennec/ha-domotwin"
FILE_PREFIXES = (
    f"{REPOSITORY}/blob/main/",
    "https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/",
)
TARGETS = re.compile(r'(?:src|href)="([^"]*)"|\]\(([^)]*)\)')


def targets(name: str) -> list[str]:
    text = (ROOT / name).read_text(encoding="utf-8")
    return [a or b for a, b in TARGETS.findall(text)]


@pytest.mark.parametrize("name", READMES)
def test_links_and_images_are_absolute(name: str) -> None:
    assert [t for t in targets(name) if not t.startswith("https://")] == []


@pytest.mark.parametrize("name", READMES)
def test_links_into_the_repository_point_to_files(name: str) -> None:
    for target in targets(name):
        for prefix in FILE_PREFIXES:
            if target.startswith(prefix):
                path = target.removeprefix(prefix).split("#")[0]
                assert (ROOT / path).is_file(), target
