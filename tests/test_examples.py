"""The fictional examples follow the published JSON Schema and the bindings format."""

from __future__ import annotations

import json
from typing import Any

import jsonschema

from custom_components.domotwin.validation import element_ids, validate_bindings, validate_plan

from .conftest import ROOT


def test_demo_plan_matches_the_schema(demo_plan: dict[str, Any]) -> None:
    schema = json.loads((ROOT / "schema" / "plan.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    errors = list(jsonschema.Draft202012Validator(schema).iter_errors(demo_plan))
    assert errors == []


def test_demo_plan_and_bindings_pass_the_integration_checks(
    demo_plan: dict[str, Any], demo_bindings: dict[str, Any]
) -> None:
    assert validate_plan(demo_plan) is demo_plan
    assert validate_bindings(demo_bindings) == demo_bindings


def test_bindings_reference_existing_elements(
    demo_plan: dict[str, Any], demo_bindings: dict[str, Any]
) -> None:
    ids = element_ids(demo_plan)
    rooms = {room["id"] for room in demo_plan["rooms"]}
    assert set(demo_bindings["elements"]) <= ids
    assert set(demo_bindings["rooms"]) <= rooms


def test_upper_floor_matches_the_schema_with_ids_of_its_own(demo_plan: dict[str, Any]) -> None:
    upper = json.loads(
        (ROOT / "examples" / "demo-upper-floor.domotwin.json").read_text(encoding="utf-8")
    )
    schema = json.loads((ROOT / "schema" / "plan.schema.json").read_text(encoding="utf-8"))
    assert list(jsonschema.Draft202012Validator(schema).iter_errors(upper)) == []
    assert validate_plan(upper) is upper
    assert not element_ids(demo_plan) & element_ids(upper)


def test_demo_house_matches_the_schema_with_ids_of_its_own() -> None:
    schema = json.loads((ROOT / "schema" / "plan.schema.json").read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    storeys = [
        json.loads((ROOT / "examples" / name).read_text(encoding="utf-8"))
        for name in ("demo-house.domotwin.json", "demo-house-upper.domotwin.json")
    ]
    for plan in storeys:
        assert list(validator.iter_errors(plan)) == []
        assert validate_plan(plan) is plan
    assert not element_ids(storeys[0]) & element_ids(storeys[1])


def test_split_level_house_matches_the_schema_with_ids_of_its_own() -> None:
    """The fictional split-level house (D-078): three storeys, no id twice."""
    schema = json.loads((ROOT / "schema" / "plan.schema.json").read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    storeys = [
        json.loads((ROOT / "examples" / f"split-level-{level}.domotwin.json").read_text("utf-8"))
        for level in ("lower", "entry", "upper")
    ]
    seen: set[str] = set()
    for plan in storeys:
        assert list(validator.iter_errors(plan)) == []
        assert validate_plan(plan) is plan
        ids = element_ids(plan)
        assert not seen & ids
        seen |= ids
