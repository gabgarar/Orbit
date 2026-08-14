"""Independent regression coverage for the static ITRF geopotential module."""

from __future__ import annotations

import hashlib
import math
from datetime import UTC, datetime
from pathlib import Path

import pytest
import orbit_api.orbits.forces.geopotential as geopotential_module
from orbit_api.orbits.forces.geopotential import (
    WGS84_J2,
    WGS84_J3,
    WGS84_J4,
    WGS84_MU_KM3_S2,
    GeopotentialConfiguration,
    GravityFieldError,
    GravityFieldModel,
    geopotential_perturbation_acceleration_itrf,
    gravity_acceleration_itrf,
    load_icgem_gfc,
    parse_icgem_gfc,
)
from orbit_api.orbits.forces.limits import MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS
from orbit_api.orbits.propagators.cowell import CowellPropagator

EPOCH = datetime(2026, 7, 20, 12, tzinfo=UTC)
NON_POLAR_POSITION_KM = (7_000.0, 1_300.0, 2_500.0)


def _state(position: tuple[float, float, float]) -> dict[str, object]:
    return {
        "position_eme2000_km": dict(zip(("x", "y", "z"), position, strict=True)),
        "velocity_eme2000_km_s": {"x": -1.2, "y": 7.1, "z": 2.3},
    }


def _zonal_only_model(*degrees: int) -> GravityFieldModel:
    legacy = GravityFieldModel.wgs84_zonal_degree4()
    coefficients = {(0, 0): legacy.coefficient(0, 0)}
    for degree in degrees:
        coefficients[(degree, 0)] = legacy.coefficient(degree, 0)
    return GravityFieldModel(
        model_id=f"test-zonal-{'-'.join(str(value) for value in degrees)}",
        source="test",
        version="1",
        sha256=None,
        mu_km3_s2=legacy.mu_km3_s2,
        reference_radius_km=legacy.reference_radius_km,
        normalization="fully_normalized",
        max_degree=max(degrees, default=0),
        coefficients=coefficients,
    )


def _legacy_cowell_perturbation(
    position: tuple[float, float, float], force_term: str
) -> tuple[float, float, float]:
    propagator = CowellPropagator(EPOCH, _state(position), force_terms=(force_term,))
    total = propagator._acceleration((*position, -1.2, 7.1, 2.3))
    radius = math.sqrt(sum(component * component for component in position))
    central = tuple(-WGS84_MU_KM3_S2 * component / radius**3 for component in position)
    return tuple(total[index] - central[index] for index in range(3))


def test_wgs84_factory_derives_legacy_zonals_in_fully_normalized_contract():
    model = GravityFieldModel.wgs84_zonal_degree4()

    assert model.normalization == "fully_normalized"
    assert model.max_degree == 4
    assert model.coefficient(0, 0) == (1.0, 0.0)
    # Degree one belongs to the model.  This geocentric compatibility field
    # carries zeros there rather than exposing an artificial J1 toggle.
    assert model.coefficient(1, 0) == (0.0, 0.0)
    assert model.coefficient(1, 1) == (0.0, 0.0)
    assert model.coefficient(2, 0) == pytest.approx((-WGS84_J2 / math.sqrt(5.0), 0.0))
    assert model.coefficient(3, 0) == pytest.approx((-WGS84_J3 / math.sqrt(7.0), 0.0))
    assert model.coefficient(4, 0) == pytest.approx((-WGS84_J4 / 3.0, 0.0))
    with pytest.raises(TypeError):
        model.coefficients[(2, 0)] = (0.0, 0.0)  # type: ignore[index]


@pytest.mark.parametrize(("degree", "force_term"), ((2, "j2"), (3, "j3"), (4, "j4")))
def test_fully_normalized_zonals_match_existing_cowell_terms_at_non_polar_points(degree, force_term):
    model = _zonal_only_model(degree)
    actual = geopotential_perturbation_acceleration_itrf(
        NON_POLAR_POSITION_KM, model, GeopotentialConfiguration(degree, 0)
    )
    expected = _legacy_cowell_perturbation(NON_POLAR_POSITION_KM, force_term)

    assert actual == pytest.approx(expected, rel=2.0e-13, abs=2.0e-18)


def test_full_zonal_degree_four_matches_legacy_combined_cowell_field():
    model = GravityFieldModel.wgs84_zonal_degree4()
    position = (7_200.0, -2_200.0, 3_100.0)
    legacy = CowellPropagator(EPOCH, _state(position), force_terms=("j2", "j3", "j4"))
    total = legacy._acceleration((*position, -1.2, 7.1, 2.3))
    radius = math.sqrt(sum(component * component for component in position))
    central = tuple(-WGS84_MU_KM3_S2 * component / radius**3 for component in position)

    actual = geopotential_perturbation_acceleration_itrf(position, model, GeopotentialConfiguration(4, 0))
    assert actual == pytest.approx(
        tuple(total[index] - central[index] for index in range(3)),
        rel=2.0e-13,
        abs=2.0e-18,
    )


def test_degree_zero_complete_field_is_exact_point_mass_gravity():
    model = GravityFieldModel.wgs84_zonal_degree4()
    position = (7_000.0, -1_500.0, 2_000.0)
    radius = math.sqrt(sum(component * component for component in position))
    actual = gravity_acceleration_itrf(position, model, GeopotentialConfiguration(0, 0))
    expected = tuple(-model.mu_km3_s2 * component / radius**3 for component in position)

    assert actual == pytest.approx(expected, rel=0.0, abs=1.0e-18)
    assert geopotential_perturbation_acceleration_itrf(
        position, model, GeopotentialConfiguration(0, 0)
    ) == (0.0, 0.0, 0.0)


def test_tesseral_coefficients_are_supported_and_depend_on_itrf_longitude():
    model = GravityFieldModel(
        model_id="synthetic-c22",
        source="test",
        version="1",
        sha256=None,
        mu_km3_s2=WGS84_MU_KM3_S2,
        reference_radius_km=6378.137,
        normalization="fully_normalized",
        max_degree=2,
        coefficients={(0, 0): (1.0, 0.0), (2, 2): (1.0e-6, -0.5e-6)},
    )
    configuration = GeopotentialConfiguration(2, 2)
    first = geopotential_perturbation_acceleration_itrf((7_000.0, 0.0, 1_000.0), model, configuration)
    second = geopotential_perturbation_acceleration_itrf((0.0, 7_000.0, 1_000.0), model, configuration)

    assert all(math.isfinite(component) for component in first + second)
    assert math.dist(first, second) > 1.0e-10


def test_exact_polar_zonal_evaluation_is_finite():
    acceleration = gravity_acceleration_itrf(
        (0.0, 0.0, 7_000.0),
        GravityFieldModel.wgs84_zonal_degree4(),
        GeopotentialConfiguration(4, 0),
    )

    assert all(math.isfinite(component) for component in acceleration)
    assert acceleration[0] == pytest.approx(0.0, abs=1.0e-17)
    assert acceleration[1] == pytest.approx(0.0, abs=1.0e-17)
    assert acceleration[2] < 0.0


def _valid_icgem_payload() -> bytes:
    return "\n".join((
        "product_type gravity_field",
        "modelname TEST-FIELD",
        "earth_gravity_constant 3.986004418e14",
        "radius 6.378137e6",
        "max_degree 2",
        "norm fully_normalized",
        "tide_system zero_tide",
        "end_of_head",
        "gfc 0 0 1.0 0.0",
        "gfc 1 0 0.0 0.0",
        "gfc 1 1 0.0 0.0",
        "gfc 2 0 -4.84165371736e-4 0.0",
        "gfc 2 1 0.0 0.0",
        "gfc 2 2 0.0 0.0",
        "",
    )).encode("utf-8")


def _dense_icgem_payload(max_degree: int) -> bytes:
    """Build a small deterministic complete field for parser boundary tests."""

    lines = [
        "product_type gravity_field",
        "modelname DENSE-TEST-FIELD",
        "earth_gravity_constant 3.986004418e14",
        "radius 6.378137e6",
        f"max_degree {max_degree}",
        "norm fully_normalized",
        "end_of_head",
    ]
    for degree in range(max_degree + 1):
        for order in range(degree + 1):
            cosine = "1.0" if (degree, order) == (0, 0) else "0.0"
            lines.append(f"gfc {degree} {order} {cosine} 0.0")
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_icgem_parser_requires_and_preserves_a_fully_normalized_static_field():
    payload = _valid_icgem_payload()
    digest = hashlib.sha256(payload).hexdigest()
    model = parse_icgem_gfc(payload, expected_sha256=digest, source="unit-test")

    assert model.model_id == "TEST-FIELD"
    assert model.sha256 == digest
    assert model.mu_km3_s2 == pytest.approx(WGS84_MU_KM3_S2)
    assert model.reference_radius_km == pytest.approx(6378.137)
    assert model.normalization == "fully_normalized"
    assert model.tide_system == "zero_tide"
    assert model.coefficient(2, 0) == pytest.approx((-4.84165371736e-4, 0.0))


def test_icgem_parser_accepts_standard_icgem2_header_boundary_separators():
    """ICGEM 2.0 surrounds header markers with decorative ``=`` runs."""

    payload = _valid_icgem_payload().replace(
        b"product_type gravity_field",
        b"begin_of_head =====================================\n"
        b"format icgem2.0\n"
        b"product_type gravity_field",
    ).replace(
        b"end_of_head",
        b"end_of_head =====================================",
    )

    model = parse_icgem_gfc(payload)

    assert model.model_id == "TEST-FIELD"
    assert model.coefficient(2, 0) == pytest.approx((-4.84165371736e-4, 0.0))


@pytest.mark.parametrize(
    ("payload", "message"),
    (
        (_valid_icgem_payload().replace(b"norm fully_normalized", b"norm unnormalized"), "fully_normalized"),
        (_valid_icgem_payload().replace(b"end_of_head", b""), "end_of_head"),
        (_valid_icgem_payload().replace(b"gfc 2 2 0.0 0.0\n", b""), "obligatorio 2,2"),
        (_valid_icgem_payload() + b"gfc 2 2 0.0 0.0\n", "duplicado"),
        (_valid_icgem_payload().replace(b"gfc 1 1 0.0 0.0", b"gfct 1 1 0.0 0.0"), "solo se admiten"),
        (_valid_icgem_payload().replace(b"end_of_head", b"end_of_head unexpected"), "solo admite"),
    ),
)
def test_icgem_parser_rejects_incomplete_or_non_static_contracts(payload, message):
    with pytest.raises(GravityFieldError, match=message):
        parse_icgem_gfc(payload)


def test_icgem_parser_rejects_sha_mismatch_and_configuration_beyond_model_limit():
    with pytest.raises(GravityFieldError, match="SHA-256"):
        parse_icgem_gfc(_valid_icgem_payload(), expected_sha256="0" * 64)
    with pytest.raises(GravityFieldError, match="supera"):
        gravity_acceleration_itrf(
            NON_POLAR_POSITION_KM,
            GravityFieldModel.wgs84_zonal_degree4(),
            GeopotentialConfiguration(5, 0),
        )


def test_icgem_parser_rejects_degree_above_the_global_safe_envelope_before_rows():
    oversized_header = _valid_icgem_payload().replace(
        b"max_degree 2",
        b"max_degree 2191",
    )

    with pytest.raises(GravityFieldError, match="2190"):
        parse_icgem_gfc(oversized_header)


def test_icgem_parser_rejects_dense_local_field_above_materialization_budget_before_rows():
    mission_scale_header = _valid_icgem_payload().replace(
        b"max_degree 2",
        b"max_degree 71",
    )

    with pytest.raises(GravityFieldError, match=r"2556.*70x70"):
        parse_icgem_gfc(mission_scale_header)


def test_icgem_parser_accepts_complete_dense_field_at_local_materialization_budget():
    model = parse_icgem_gfc(_dense_icgem_payload(70))

    assert model.max_degree == 70
    assert len(model.coefficients) == MAX_LOCAL_ICGEM_MATERIALIZED_COEFFICIENTS


def test_icgem_parser_rejects_oversized_payload_before_hashing_or_decoding(monkeypatch):
    monkeypatch.setattr(geopotential_module, "MAX_LOCAL_ICGEM_FILE_BYTES", 32)

    with pytest.raises(GravityFieldError, match=r"límite seguro de 32 bytes"):
        parse_icgem_gfc(b"x" * 33)


def test_icgem_loader_uses_bounded_file_read_for_a_valid_small_field(tmp_path, monkeypatch):
    field = tmp_path / "small-field.gfc"
    field.write_bytes(_valid_icgem_payload())

    def _unexpected_read_bytes(_self):
        raise AssertionError("load_icgem_gfc must not call Path.read_bytes")

    monkeypatch.setattr(Path, "read_bytes", _unexpected_read_bytes)

    model = load_icgem_gfc(field)

    assert model.model_id == "TEST-FIELD"


@pytest.mark.parametrize("configuration", ((-1, 0), (2, 3), (2.5, 0), (True, 0)))
def test_geopotential_configuration_rejects_invalid_degree_and_order(configuration):
    with pytest.raises(GravityFieldError):
        GeopotentialConfiguration(*configuration)
