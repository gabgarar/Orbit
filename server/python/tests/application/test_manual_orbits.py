"""Manual-orbit conversion, native-engine selection, and route adapter tests."""

import base64
import math
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.application.manual_orbits import (
    ManualOrbitError,
    build_manual_orbit_propagator,
    canonical_manual_orbit,
)
from orbit_api.application.manual_erp import ManualErpRepository
from orbit_api.domain.requests import (
    LEGACY_MANUAL_ORBIT_PROPAGATORS,
    MANUAL_ORBIT_PROPAGATORS,
    MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE,
    ManualOrbitRequest,
)
from orbit_api.orbits.forces.geopotential import GravityFieldModel
from orbit_api.orbits.propagators.cowell import CowellPropagator
from orbit_api.orbits.propagators.j2_j3_j4 import J2J3J4Propagator
from orbit_api.orbits.propagators.two_body import TwoBodyPropagator
from pydantic import ValidationError


def keplerian_payload(**overrides):
    payload = {
        "name": "Manual test",
        "epochUtc": "2026-07-20T12:00:00Z",
        "propagator": "two-body",
        "keplerian": {
            "semiMajorAxisKm": 6878,
            "eccentricity": 0.001,
            "inclinationDeg": 51.6,
            "raanDeg": 20,
            "argumentOfPeriapsisDeg": 45,
            "trueAnomalyDeg": 90,
        },
    }
    payload.update(overrides)
    return payload


def _manual_erp_text() -> str:
    """A local ERP covering the manual-orbit fixture epoch and horizon."""

    return "\n".join((
        "VERSION 2",
        "MJD Xpole Ypole UT1-UTC LOD",
        "61240.00000000 100000 -200000 2500000 10000",
        "61243.00000000 120000 -180000 2600000 11000",
    ))


@pytest.fixture
def manual_erp_snapshot(tmp_path):
    repository = ManualErpRepository(tmp_path / "manual-erp-snapshots")
    content = base64.b64encode(_manual_erp_text().encode("utf-8")).decode("ascii")
    return repository, repository.save_upload("manual-force.erp", content)


def test_manual_request_accepts_editor_camel_case_with_a_native_eme2000_definition():
    request = ManualOrbitRequest(**keplerian_payload())
    source, keplerian, state_vector = canonical_manual_orbit(request)

    assert request.propagator == "two-body"
    assert source == "keplerian"
    assert state_vector["reference_frame"] == "EME2000"
    assert state_vector["legacy_reference_frame"] == "ECI"
    assert keplerian["mean_anomaly_deg"] != keplerian["true_anomaly_deg"]


def test_manual_request_accepts_flat_state_vector_and_derives_keplerian():
    request = ManualOrbitRequest(
        name="State vector test",
        epoch="2026-07-20T12:00:00+00:00",
        source="stateVector",
        stateVector={
            "positionXKm": 7000,
            "positionYKm": 0,
            "positionZKm": 0,
            "velocityXKmS": 0,
            "velocityYKmS": 7.5,
            "velocityZKmS": 1.0,
        },
    )
    source, keplerian, state_vector = canonical_manual_orbit(request)

    assert source == "state_vector"
    assert keplerian["semi_major_axis_km"] > 6378
    assert 0 <= keplerian["eccentricity"] < 1
    assert state_vector["reference_frame"] == "EME2000"
    assert state_vector["position_eme2000_km"]["x"] == 7000
    assert state_vector["velocity_eme2000_km_s"]["z"] == 1.0
    # Keep the editor's former field names as aliases while readers migrate,
    # but do not use them as the source-frame declaration.
    assert state_vector["position_eci_km"] == state_vector["position_eme2000_km"]
    assert state_vector["velocity_eci_km_s"] == state_vector["velocity_eme2000_km_s"]


def test_manual_request_normalizes_native_propagator_aliases_and_rejects_unsupported_ones():
    assert MANUAL_ORBIT_PROPAGATORS == ("two-body", "cowell-rk4")
    assert LEGACY_MANUAL_ORBIT_PROPAGATORS == ("sgp4", "j2-j3-j4")
    default_payload = keplerian_payload()
    default_payload.pop("propagator")
    assert ManualOrbitRequest(**default_payload).propagator == "two-body"
    assert ManualOrbitRequest(**keplerian_payload(propagator="kepler")).propagator == "two-body"
    assert ManualOrbitRequest(**keplerian_payload(propagator="two_body")).propagator == "two-body"
    # A saved synthetic-SGP4 record still deserializes so the caller can
    # report it as unavailable instead of silently changing its model.
    assert ManualOrbitRequest(**keplerian_payload(propagator="SGP-4")).propagator == "sgp4"
    assert ManualOrbitRequest(**keplerian_payload(propagator="J2 + J3 + J4")).propagator == "j2-j3-j4"
    assert ManualOrbitRequest(**keplerian_payload(propagator="cowell")).propagator == "cowell-rk4"
    assert ManualOrbitRequest(**keplerian_payload(propagator="Cowell / RK4")).propagator == "cowell-rk4"
    with pytest.raises(ValidationError, match="Propagador manual no compatible"):
        ManualOrbitRequest(**keplerian_payload(propagator="gauss-jackson"))
    with pytest.raises(ValidationError, match="Propagador manual no compatible"):
        ManualOrbitRequest(**keplerian_payload(propagator="j2"))
    with pytest.raises(ValidationError, match="Propagador manual no compatible"):
        ManualOrbitRequest(**keplerian_payload(propagator="j2-secular"))


def test_manual_request_normalizes_metadata_and_cowell_drag_options_and_restricts_other_models():
    request = ManualOrbitRequest(**keplerian_payload(
        propagator="cowell",
        objectMetadata={
            "objectType": "  Satellite  ",
            "missionType": "Earth observation",
            "operator": " Orbit Lab ",
            "country": "ES",
            "launchDate": "2026-07-20",
        },
        propagationOptions={
            "atmosphericDrag": True,
            # New clients can describe this as a force model without
            # reintroducing J2/J3/J4 as public propagator choices.
            "forceModel": "J2 + J3 + J4",
            "numericalIntegrator": "Runge Kutta 4",
            "dragCoefficient": 2.4,
            "areaM2": 3.5,
            "massKg": 240,
        },
    ))

    assert request.propagator == "cowell-rk4"
    assert request.object_metadata.canonical() == {
        "object_type": "Satellite",
        "mission_type": "Earth observation",
        "operator": "Orbit Lab",
        "country": "ES",
        "launch_date": "2026-07-20",
    }
    assert request.propagation_options.canonical() == {
        "force_terms": ["central", "j2", "j3", "j4", "drag"],
        "atmospheric_drag": True,
        "cowell_gravity_model": "j2-j3-j4",
        "numerical_integrator": "rk4",
        "drag_coefficient": 2.4,
        "area_m2": 3.5,
        "mass_kg": 240.0,
    }
    with pytest.raises(ValidationError, match="Cowell/RK4"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="two-body",
            propagationOptions={"atmosphericDrag": True},
        ))
    with pytest.raises(ValidationError, match="Integrador num"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions={"numericalIntegrator": "dopri5"},
        ))


def test_explicit_cowell_force_terms_are_canonical_and_override_legacy_aliases():
    request = ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        propagationOptions={
            # Central is inserted even if a UI only sends optional terms.
            "forceTerms": ["j3", "drag"],
            # These compatibility aliases must not re-enable J2 or alter the
            # explicit drag decision above.
            "forceModel": "j2-j3-j4",
            "atmosphericDrag": False,
        },
    ))

    assert request.propagation_options.force_terms == ("central", "j3", "drag")
    assert request.propagation_options.atmospheric_drag is True
    assert request.propagation_options.cowell_gravity_model is None
    assert request.propagation_options.canonical()["force_terms"] == ["central", "j3", "drag"]
    assert "cowell_gravity_model" not in request.propagation_options.canonical()


def test_clean_defaults_and_legacy_drag_only_payloads_keep_their_distinct_physics():
    clean = ManualOrbitRequest(**keplerian_payload(propagator="cowell-rk4"))
    legacy_drag_only = ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        # Historical clients could send only the drag switch. Before explicit
        # force terms existed, that meant the full zonal Cowell preset.
        propagationOptions={"atmosphericDrag": True},
    ))

    assert clean.propagation_options.force_terms == ("central",)
    assert clean.propagation_options.canonical(propagator="cowell-rk4")["force_terms"] == ["central"]
    assert legacy_drag_only.propagation_options.force_terms == (
        "central", "j2", "j3", "j4", "drag",
    )
    assert legacy_drag_only.propagation_options.atmospheric_drag is True


@pytest.mark.parametrize(
    ("propagator", "expected_terms"),
    [
        ("two-body", ["central"]),
        ("j2-j3-j4", ["central", "j2", "j3", "j4"]),
    ],
)
def test_fixed_engines_ignore_future_non_drag_cowell_controls(
    propagator,
    expected_terms,
):
    future_options = {
        "forceTerms": ["central", "srp"],
        "numericalIntegrator": "dopri8",
    }
    fixed = ManualOrbitRequest(**keplerian_payload(
        propagator=propagator,
        propagationOptions=future_options,
    ))

    assert fixed.propagation_options.force_terms == tuple(expected_terms)
    assert fixed.propagation_options.canonical(propagator=propagator) == {
        "force_terms": expected_terms,
        "atmospheric_drag": False,
    }


def test_cowell_rejects_future_non_installed_force_terms():
    future_options = {
        "forceTerms": ["central", "experimental-tide"],
        "numericalIntegrator": "dopri8",
    }
    with pytest.raises(ValidationError, match="Cowell no compatible"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions=future_options,
        ))


def test_cowell_accepts_new_physical_force_terms_and_rejects_geopotential_double_counting():
    request = ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        propagationOptions={
            "forceTerms": [
                "geopotential",
                "third-body-sun",
                "third-body-moon",
                "solar-radiation-pressure",
                "relativity",
            ],
            "geopotentialDegree": 12,
            "geopotentialOrder": 8,
            "solarRadiationCoefficient": 1.35,
            "areaM2": 4.0,
            "massKg": 200.0,
        },
    ))

    canonical = request.propagation_options.canonical(propagator="cowell-rk4")
    assert canonical["force_terms"] == [
        "central", "geopotential", "third-body-sun", "third-body-moon",
        "solar-radiation-pressure", "relativity",
    ]
    assert canonical["geopotential_degree"] == 12
    assert canonical["geopotential_order"] == 8
    assert canonical["solar_radiation_coefficient"] == 1.35

    with pytest.raises(ValidationError, match="no puede combinarse"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions={"forceTerms": ["geopotential", "j2"]},
        ))
    with pytest.raises(ValidationError, match="degree >= 2"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions={
                "forceTerms": ["geopotential"],
                "geopotentialDegree": 1,
                "geopotentialOrder": 0,
            },
        ))


def test_public_cowell_geopotential_degree_has_a_bounded_execution_budget():
    """EGM2008's 2159 ceiling is distinct from the current RK4 cost guard."""

    request = ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        propagationOptions={
            "forceTerms": ["geopotential"],
            "geopotentialDegree": 2159,
            "geopotentialOrder": 2159,
        },
    ))
    assert request.propagation_options.geopotential_degree == 2159

    with pytest.raises(ValidationError, match="less than or equal to 2159"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions={
                "forceTerms": ["geopotential"],
                "geopotentialDegree": 2160,
                "geopotentialOrder": 0,
            },
        ))


def test_cowell_builder_exposes_configured_geopotential_provenance(manual_erp_snapshot):
    request = ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        propagationOptions={
            "forceTerms": ["geopotential"],
            "geopotentialDegree": 4,
            "geopotentialOrder": 0,
        },
    ))
    _source, keplerian, state_vector = canonical_manual_orbit(request)
    _repository, erp = manual_erp_snapshot
    name, propagator, metadata = build_manual_orbit_propagator(
        request.propagator,
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        propagation_options=request.propagation_options.canonical(propagator="cowell-rk4"),
        gravity_field=GravityFieldModel.wgs84_zonal_degree4(),
        manual_erp_provider=erp.provider,
        manual_erp_snapshot_id=erp.snapshot_id,
    )

    assert name.startswith("manual:cowell-rk4:")
    assert isinstance(propagator, CowellPropagator)
    assert metadata["geopotential"]["degree"] == 4
    assert metadata["geopotential"]["evaluation_frame"] == "ITRF"


def test_manual_force_capabilities_report_absent_or_pinned_gravity_data_without_claiming_epoch_coverage():
    router = create_manual_orbits_router(
        lambda *_args: {"points": []},
        lambda value: value,
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits/capabilities")
    absent = endpoint()

    assert absent["cowell"]["geopotential"]["available"] is False
    assert absent["cowell"]["temporal_route"]["epoch_coverage_validated_on_propagation"] is True

    model = GravityFieldModel.wgs84_zonal_degree4()
    configured_router = create_manual_orbits_router(
        lambda *_args: {"points": []},
        lambda value: value,
        gravity_field=model,
    )
    configured_endpoint = next(
        route.endpoint for route in configured_router.routes
        if route.path == "/manual-orbits/capabilities"
    )
    configured = configured_endpoint()

    assert configured["cowell"]["geopotential"]["available"] is True
    assert configured["cowell"]["geopotential"]["model"]["id"] == model.model_id
    assert configured["cowell"]["geopotential"]["model"]["max_selectable_degree"] == 4
    assert configured["cowell"]["geopotential"]["model"]["execution_limit"]["semantic_max_degree"] == 2159
    assert configured["cowell"]["geopotential"]["model"]["execution_limit"] == {
        "semantic_max_degree": 2159,
        "max_harmonic_terms": 2555,
        "full_degree_order_example": {"degree": 70, "order": 70},
        "enforcement": "validated before propagation",
        "reason": (
            "bounded pure-Python RK4 evaluation; configurations above the harmonic-term "
            "budget require a validated optimized evaluator"
        ),
    }


def test_two_body_preserves_the_eme2000_epoch_state():
    request = ManualOrbitRequest(**keplerian_payload())
    _, keplerian, state_vector = canonical_manual_orbit(request)
    epoch = request.epoch
    two_body = TwoBodyPropagator(epoch, keplerian)
    state_at_epoch = two_body.propagate_eme2000_datetime(epoch)
    expected_epoch_state = (
        state_vector["position_eme2000_km"]["x"],
        state_vector["position_eme2000_km"]["y"],
        state_vector["position_eme2000_km"]["z"],
        state_vector["velocity_eme2000_km_s"]["x"],
        state_vector["velocity_eme2000_km_s"]["y"],
        state_vector["velocity_eme2000_km_s"]["z"],
    )
    for actual, expected in zip(state_at_epoch, expected_epoch_state, strict=True):
        assert math.isclose(actual, expected, abs_tol=1e-8)


def test_direct_builder_projects_stale_cowell_terms_onto_fixed_engines():
    request = ManualOrbitRequest(**keplerian_payload(propagator="two-body"))
    _, keplerian, state_vector = canonical_manual_orbit(request)

    clean_name, clean_propagator, _metadata = build_manual_orbit_propagator(
        "two-body",
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
    )
    stale_name, stale_propagator, stale_metadata = build_manual_orbit_propagator(
        "two-body",
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        propagation_options={
            "forceTerms": ["central", "srp"],
            "numericalIntegrator": "dopri8",
        },
    )

    assert isinstance(clean_propagator, TwoBodyPropagator)
    assert isinstance(stale_propagator, TwoBodyPropagator)
    # The cache identity contains effective, not ignored, configuration.
    assert stale_name == clean_name
    assert stale_metadata["id"] == "two-body"


def test_native_manual_runtime_identity_uses_propagator_epoch_and_state_not_display_name(manual_erp_snapshot):
    request = ManualOrbitRequest(**keplerian_payload(propagator="two-body"))
    _, keplerian, state_vector = canonical_manual_orbit(request)

    first_name, first_prop, first_metadata = build_manual_orbit_propagator(
        request.propagator,
        name="Same display name",
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
    )
    changed_state = {
        **state_vector,
        "position_eme2000_km": {**state_vector["position_eme2000_km"], "x": 7001},
        # Retain the compatibility alias in lockstep, because old persisted
        # manual records still deserialize through this key.
        "position_eci_km": {**state_vector["position_eci_km"], "x": 7001},
    }
    second_name, _, _ = build_manual_orbit_propagator(
        request.propagator,
        name="Same display name",
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=changed_state,
    )
    _repository, erp = manual_erp_snapshot
    drag_name, drag_propagator, drag_metadata = build_manual_orbit_propagator(
        "cowell-rk4",
        name="Same display name",
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        propagation_options={
            "atmospheric_drag": True,
            "cowell_gravity_model": "two-body",
            "numerical_integrator": "rk4",
            "drag_coefficient": 2.2,
            "area_m2": 2.0,
            "mass_kg": 100.0,
        },
        manual_erp_provider=erp.provider,
        manual_erp_snapshot_id=erp.snapshot_id,
    )

    assert isinstance(first_prop, TwoBodyPropagator)
    assert first_name.startswith("manual:two-body:")
    assert first_name != second_name
    assert drag_name != first_name
    assert drag_name.startswith("manual:cowell-rk4:")
    assert isinstance(drag_propagator, CowellPropagator)
    assert drag_metadata["applied_engine"] == "cowell-rk4"
    assert drag_metadata["integrator_id"] == "rk4"
    assert "Runge" in drag_metadata["integrator_label"]
    assert first_metadata["id"] == "two-body"
    assert first_metadata["dynamics_reference_frame"] == "EME2000"


def test_legacy_sgp4_manual_definition_deserializes_but_builder_rejects_it():
    legacy = ManualOrbitRequest(**keplerian_payload(
        propagator="sgp4",
        propagationOptions={"atmosphericDrag": True},
    ))
    _, keplerian, state_vector = canonical_manual_orbit(legacy)

    assert legacy.propagator == "sgp4"
    assert legacy.propagation_options.atmospheric_drag is True
    with pytest.raises(ManualOrbitError, match="SGP4 no está disponible"):
        build_manual_orbit_propagator(
            legacy.propagator,
            name=legacy.name,
            epoch=legacy.epoch,
            keplerian=keplerian,
            state_vector=state_vector,
        )


def test_manual_route_rejects_legacy_sgp4_without_building_ephemeris():
    calls = []

    def build_ephemeris(*_args):
        calls.append("build")
        raise AssertionError("A legacy SGP4 manual record must not be propagated")

    router = create_manual_orbits_router(
        build_ephemeris,
        lambda value: value.astimezone(UTC),
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")

    with pytest.raises(HTTPException) as rejected:
        endpoint(ManualOrbitRequest(**keplerian_payload(propagator="sgp4")))

    assert rejected.value.status_code == 422
    assert rejected.value.detail == MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE
    assert calls == []


def test_manual_route_uses_native_model_and_returns_display_named_itrf_ephemeris():
    calls = []

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        assert name.startswith("manual:two-body:") and isinstance(propagator, TwoBodyPropagator)
        assert start.tzinfo is UTC and end > start and step == 30 and include_velocity is True
        calls.append(name)
        return {
            "satellite": name,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 1,
            "points": [{
                "satellite": name,
                "time": start.isoformat(),
                "reference_frame": "ITRF",
                "position_units": "m",
                "velocity_units": "m/s",
                "position": {"x": 1, "y": 2, "z": 3},
                "velocity": {"x": 4, "y": 5, "z": 6},
            }],
        }

    router = create_manual_orbits_router(build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(horizonHours=2)))

    assert calls
    assert response["name"] == "Manual test"
    assert response["epochUtc"].endswith("+00:00")
    assert response["ephemeris"]["satellite"] == "Manual test"
    assert response["ephemeris"]["points"][0]["satellite"] == "Manual test"
    assert response["ephemeris"]["points"][0]["reference_frame"] == "ITRF"
    assert response["tle"] is None
    assert response["propagation_options"] == {
        "force_terms": ["central"],
        "atmospheric_drag": False,
    }
    assert response["propagation"]["range_source"] == "horizon_hours"
    assert response["propagation"]["duration_hours"] == 2
    assert response["orbit_summary"]["perigee_altitude_km"] > 0
    assert response["orbit_summary"]["apogee_altitude_km"] > response["orbit_summary"]["perigee_altitude_km"]


def test_manual_route_prefers_an_explicit_end_time_over_horizon_hours():
    calls = []

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        calls.append((name, propagator, start, end, step, include_velocity))
        return {
            "satellite": name,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 2,
            "points": [],
        }

    router = create_manual_orbits_router(build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(
        startTime="2026-07-20T10:00:00Z",
        endTime="2026-07-20T13:30:00Z",
        horizonHours=72,
    )))

    assert calls[0][2] == datetime(2026, 7, 20, 10, 0, tzinfo=UTC)
    assert calls[0][3] == datetime(2026, 7, 20, 13, 30, tzinfo=UTC)
    assert response["propagation"] == {
        "start_time": "2026-07-20T10:00:00+00:00",
        "end_time": "2026-07-20T13:30:00+00:00",
        "duration_seconds": 12_600.0,
        "duration_hours": 3.5,
        "step_seconds": 30.0,
        "points_count": 2,
        "range_source": "explicit_end_time",
        "propagator": "two-body",
        "applied_engine": "analytical",
        "atmospheric_drag": False,
    }


@pytest.mark.parametrize(
    ("requested_propagator", "expected_type", "canonical", "expected_force_terms"),
    [
        ("two_body", TwoBodyPropagator, "two-body", ["central"]),
    ],
)
def test_manual_route_uses_native_models_without_synthetic_tle(
    requested_propagator,
    expected_type,
    canonical,
    expected_force_terms,
):
    calls = []

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        calls.append((name, propagator, start, end, step, include_velocity))
        return {
            "satellite": name,
            "reference_frame": "ITRF",
            "eci_samples_available": True,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 0,
            "points": [],
        }

    router = create_manual_orbits_router(build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(propagator=requested_propagator)))

    assert len(calls) == 1
    assert calls[0][0].startswith(f"manual:{canonical}:")
    assert isinstance(calls[0][1], expected_type)
    assert response["propagator"] == canonical
    assert response["tle"] is None
    assert response["reference_frame"] == "ITRF"
    metadata = response["propagator_metadata"]
    assert metadata["id"] == canonical
    assert metadata["label"] == "Two-body"
    assert metadata["dynamics_reference_frame"] == "EME2000"
    assert metadata["input_reference_frame"] == "EME2000"
    assert metadata["legacy_input_reference_frame"] == "ECI"
    assert metadata["ephemeris_reference_frame"] == "ITRF"
    assert metadata["eci_samples_available"] is True
    assert metadata["eci_samples_field"] == "ephemeris.points[].eci"
    assert response["propagation_options"] == {
        "force_terms": expected_force_terms,
        "atmospheric_drag": False,
    }


def test_manual_route_keeps_j2_j3_j4_as_a_fixed_no_drag_preset():
    calls = []

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        calls.append((name, propagator, start, end, step, include_velocity))
        return {
            "satellite": name,
            "reference_frame": "ITRF",
            "eci_samples_available": True,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 0,
            "points": [],
        }

    router = create_manual_orbits_router(build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(
        propagator="j2-j3-j4",
    )))

    assert len(calls) == 1
    assert isinstance(calls[0][1], J2J3J4Propagator)
    assert not isinstance(calls[0][1], CowellPropagator)
    assert response["tle"] is None
    assert response["propagator"] == "j2-j3-j4"
    assert response["propagator_metadata"]["applied_engine"] == "j2-j3-j4"
    assert response["propagator_metadata"]["force_model_id"] == "j2-j3-j4"
    assert response["propagator_metadata"]["atmospheric_drag_supported"] is False
    assert response["propagator_metadata"]["legacy_propagator"] is True
    assert response["propagator_metadata"]["integrator_id"] == "rk4"
    assert response["propagation_options"] == {
        "force_terms": ["central", "j2", "j3", "j4"],
        "atmospheric_drag": False,
    }


@pytest.mark.parametrize(
    ("force_model", "expected_terms", "expected_gravity_model"),
    [
        ("two-body", ["central", "drag"], "WGS-84 central gravity + first-order atmospheric drag"),
        ("j2", ["central", "j2", "drag"], "WGS-84 central gravity + J2 + first-order atmospheric drag"),
        ("j2-j3-j4", ["central", "j2", "j3", "j4", "drag"], "WGS-84 central gravity + J2 + J3 + J4 + first-order atmospheric drag"),
    ],
)
def test_manual_route_uses_explicit_cowell_for_configurable_drag(
    force_model,
    expected_terms,
    expected_gravity_model,
    manual_erp_snapshot,
):
    calls = []

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        calls.append((name, propagator, start, end, step, include_velocity))
        return {
            "satellite": name,
            "reference_frame": "ITRF",
            "eci_samples_available": True,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "step_seconds": step,
            "count": 0,
            "points": [],
        }

    options = {
        "atmosphericDrag": True,
        "forceModel": force_model,
        "numericalIntegrator": "rk4",
        "dragCoefficient": 2.1,
        "areaM2": 2,
        "massKg": 120,
    }
    repository, erp = manual_erp_snapshot
    router = create_manual_orbits_router(
        build_ephemeris,
        lambda value: value.astimezone(UTC),
        manual_erp_repository=repository,
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        objectMetadata={"objectType": "Satellite", "launchDate": "2026-07-20"},
        propagationOptions=options,
        manualErp={"snapshotId": erp.snapshot_id},
    )))

    assert len(calls) == 1
    assert isinstance(calls[0][1], CowellPropagator)
    assert response["tle"] is None
    assert response["propagator"] == "cowell-rk4"
    assert response["propagator_metadata"]["applied_engine"] == "cowell-rk4"
    assert response["propagator_metadata"]["integrator_id"] == "rk4"
    assert "Runge" in response["propagator_metadata"]["integrator_label"]
    assert response["propagator_metadata"]["force_terms"] == expected_terms
    assert response["propagator_metadata"]["force_model_id"] == force_model
    assert response["propagator_metadata"]["gravity_model"] == expected_gravity_model
    assert response["propagation_options"] == {
        "force_terms": expected_terms,
        "atmospheric_drag": True,
        "cowell_gravity_model": force_model,
        "numerical_integrator": "rk4",
        "drag_coefficient": 2.1,
        "area_m2": 2.0,
        "mass_kg": 120.0,
    }
    assert response["object_metadata"]["object_type"] == "Satellite"
    assert response["objectMetadata"]["launchDate"] == "2026-07-20"
    assert response["propagationOptions"]["forceModel"] == force_model
    assert response["propagationOptions"]["forceTerms"] == expected_terms
    assert response["propagationOptions"]["numericalIntegrator"] == "rk4"


def test_manual_route_converts_native_propagation_failure_to_a_correctable_422(manual_erp_snapshot):
    def build_ephemeris(*_args):
        raise ValueError("La propagaciÃ³n intersecta la Tierra")

    repository, erp = manual_erp_snapshot
    router = create_manual_orbits_router(
        build_ephemeris,
        lambda value: value.astimezone(UTC),
        manual_erp_repository=repository,
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")

    with pytest.raises(HTTPException) as error:
        endpoint(ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions={"atmosphericDrag": True, "cowellGravityModel": "j2"},
            manualErp={"snapshotId": erp.snapshot_id},
        )))

    assert error.value.status_code == 422
    assert "intersecta" in error.value.detail
