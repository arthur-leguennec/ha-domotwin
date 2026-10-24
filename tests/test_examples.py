"""The fictional examples follow the published JSON Schema and the bindings format."""

from __future__ import annotations

import json
from typing import Any

import jsonschema

from custom_components.domotwin.validation import validate_bindings, validate_plan

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
    ids = {element["id"] for element in demo_plan["elements"]}
    rooms = {element["id"] for element in demo_plan["elements"] if element["type"] == "room"}
    assert set(demo_bindings["elements"]) <= ids
    assert set(demo_bindings["rooms"]) <= rooms


def test_upper_floor_matches_the_schema_with_ids_of_its_own(demo_plan: dict[str, Any]) -> None:
    upper = json.loads(
        (ROOT / "examples" / "demo-upper-floor.plan.json").read_text(encoding="utf-8")
    )
    schema = json.loads((ROOT / "schema" / "plan.schema.json").read_text(encoding="utf-8"))
    assert list(jsonschema.Draft202012Validator(schema).iter_errors(upper)) == []
    assert validate_plan(upper) is upper
    ids = {element["id"] for element in demo_plan["elements"]}
    assert not ids & {element["id"] for element in upper["elements"]}
