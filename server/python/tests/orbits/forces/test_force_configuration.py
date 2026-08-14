"""Startup contracts for the local configurable gravity-field input."""

from __future__ import annotations

import hashlib

import pytest
from orbit_api.orbits.forces.configuration import (
    build_gravity_field_from_environment,
    local_icgem_model_payload,
)
from orbit_api.orbits.forces.geopotential import GravityFieldError, GravityFieldModel


def _icgem_payload() -> bytes:
    return "\n".join((
        "product_type gravity_field",
        "modelname LOCAL-TEST",
        "earth_gravity_constant 3.986004418e14",
        "radius 6.378137e6",
        "max_degree 2",
        "norm fully_normalized",
        "end_of_head",
        "gfc 0 0 1 0",
        "gfc 1 0 0 0",
        "gfc 1 1 0 0",
        "gfc 2 0 -4.84165371736e-4 0",
        "gfc 2 1 0 0",
        "gfc 2 2 0 0",
        "",
    )).encode("utf-8")


def test_absent_gravity_field_is_an_explicit_valid_legacy_configuration():
    assert build_gravity_field_from_environment({}) is None


def test_local_icgem_field_requires_and_verifies_its_sha256(tmp_path):
    field = tmp_path / "local.gfc"
    payload = _icgem_payload()
    field.write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()

    model = build_gravity_field_from_environment({
        "ORBIT_GRAVITY_FIELD_PATH": str(field),
        "ORBIT_GRAVITY_FIELD_SHA256": digest,
        "ORBIT_GRAVITY_FIELD_SOURCE": "unit-test field",
        "ORBIT_GRAVITY_FIELD_VERSION": "2026.1",
    })

    assert model is not None
    assert model.model_id == "LOCAL-TEST"
    assert model.sha256 == digest
    assert model.source == "unit-test field"
    assert model.version == "2026.1"

    with pytest.raises(GravityFieldError, match="SHA256 es obligatorio"):
        build_gravity_field_from_environment({"ORBIT_GRAVITY_FIELD_PATH": str(field)})
    with pytest.raises(GravityFieldError, match="no coincide"):
        build_gravity_field_from_environment({
            "ORBIT_GRAVITY_FIELD_PATH": str(field),
            "ORBIT_GRAVITY_FIELD_SHA256": "0" * 64,
        })


@pytest.mark.parametrize("key", (
    "ORBIT_GRAVITY_FIELD_SHA256",
    "ORBIT_GRAVITY_FIELD_SOURCE",
    "ORBIT_GRAVITY_FIELD_VERSION",
))
def test_gravity_provenance_never_configures_without_a_local_field_path(key):
    with pytest.raises(GravityFieldError, match="ORBIT_GRAVITY_FIELD_PATH"):
        build_gravity_field_from_environment({key: "x" if key != "ORBIT_GRAVITY_FIELD_SHA256" else "f" * 64})


def test_local_icgem_diagnostics_places_validation_at_model_level():
    payload = local_icgem_model_payload(GravityFieldModel.wgs84_zonal_degree4())

    assert payload is not None
    assert payload["validation"] == "complete triangular ICGEM gfc coverage validated"
    assert "validation" not in payload["coverage"]
    assert payload["coverage"]["degreeCoverage"][0]["orderRule"] == "degree"
