"""Manual-orbit conversion, TLE construction, and route adapter tests."""

from datetime import UTC, datetime, timedelta
import math

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.application.manual_orbits import (
    build_manual_orbit_propagator,
    build_synthetic_tle,
    canonical_manual_orbit,
    is_valid_tle_checksum,
)
from orbit_api.domain.requests import MANUAL_ORBIT_PROPAGATORS, ManualOrbitRequest
from orbit_api.orbits.propagators.cowell import CowellPropagator
from orbit_api.orbits.propagators.j2 import J2Propagator
from orbit_api.orbits.propagators.j2_j3_j4 import J2J3J4Propagator
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator
from orbit_api.orbits.propagators.two_body import TwoBodyPropagator


def keplerian_payload(**overrides):
    payload = {
        "name": "Manual test",
        "epochUtc": "2026-07-20T12:00:00Z",
        "propagator": "sgp4",
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


def test_manual_request_accepts_editor_camel_case_and_generates_valid_synthetic_tle():
    request = ManualOrbitRequest(**keplerian_payload())
    source, keplerian, state_vector = canonical_manual_orbit(request)
    tle = build_synthetic_tle(request.name, request.epoch, keplerian)

    assert source == "keplerian"
    assert state_vector["reference_frame"] == "ECI"
    assert keplerian["mean_anomaly_deg"] != keplerian["true_anomaly_deg"]
    assert len(tle["line1"]) == len(tle["line2"]) == 69
    assert is_valid_tle_checksum(tle["line1"])
    assert is_valid_tle_checksum(tle["line2"])
    assert tle["synthetic"] is True
    propagated = SGP4Propagator(tle["line1"], tle["line2"]).propagate_datetime(datetime(2026, 7, 20, 12, 0, 0))
    assert len(propagated) == 6 and all(math.isfinite(component) for component in propagated)


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
    assert state_vector["position_eci_km"]["x"] == 7000
    assert state_vector["velocity_eci_km_s"]["z"] == 1.0


def test_manual_request_normalizes_native_propagator_aliases_and_rejects_unknown_ones():
    # These are the only choices a new manual-design UI should present. J2
    # variants below are accepted exclusively to keep old project records
    # physically stable.
    assert MANUAL_ORBIT_PROPAGATORS == ("sgp4", "two-body", "cowell-rk4")
    default_payload = keplerian_payload()
    default_payload.pop("propagator")
    assert ManualOrbitRequest(**default_payload).propagator == "two-body"
    assert ManualOrbitRequest(**keplerian_payload(propagator="kepler")).propagator == "two-body"
    assert ManualOrbitRequest(**keplerian_payload(propagator="two_body")).propagator == "two-body"
    assert ManualOrbitRequest(**keplerian_payload(propagator="J2")).propagator == "j2"
    assert ManualOrbitRequest(**keplerian_payload(propagator="j2-secular")).propagator == "j2"
    assert ManualOrbitRequest(**keplerian_payload(propagator="J2 + J3 + J4")).propagator == "j2-j3-j4"
    assert ManualOrbitRequest(**keplerian_payload(propagator="cowell")).propagator == "cowell-rk4"
    assert ManualOrbitRequest(**keplerian_payload(propagator="Cowell / RK4")).propagator == "cowell-rk4"
    with pytest.raises(ValidationError, match="Propagador manual no compatible"):
        ManualOrbitRequest(**keplerian_payload(propagator="gauss-jackson"))


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
    with pytest.raises(ValidationError, match="BSTAR"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="sgp4",
            propagationOptions={"atmosphericDrag": True},
        ))
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
        ("sgp4", ["central"]),
        ("j2", ["central", "j2"]),
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
        "forceTerms": ["central", "srp"],
        "numericalIntegrator": "dopri8",
    }
    with pytest.raises(ValidationError, match="Cowell no compatible"):
        ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions=future_options,
        ))


def test_native_manual_propagators_preserve_the_epoch_state_and_j2_precesses():
    request = ManualOrbitRequest(**keplerian_payload())
    _, keplerian, state_vector = canonical_manual_orbit(request)
    epoch = request.epoch
    two_body = TwoBodyPropagator(epoch, keplerian)
    state_at_epoch = two_body.propagate_eci_datetime(epoch)
    expected_epoch_state = (
        state_vector["position_eci_km"]["x"],
        state_vector["position_eci_km"]["y"],
        state_vector["position_eci_km"]["z"],
        state_vector["velocity_eci_km_s"]["x"],
        state_vector["velocity_eci_km_s"]["y"],
        state_vector["velocity_eci_km_s"]["z"],
    )
    for actual, expected in zip(state_at_epoch, expected_epoch_state, strict=True):
        assert math.isclose(actual, expected, abs_tol=1e-8)

    j2 = J2Propagator(epoch, keplerian)
    tomorrow = datetime(2026, 7, 21, 12, 0, tzinfo=UTC)
    assert j2.raan_rate_rad_s < 0
    assert not math.isclose(j2.elements_at(tomorrow).raan_rad, j2.elements.raan_rad, abs_tol=1e-9)
    assert j2.elements_at(tomorrow).semi_major_axis_km == j2.elements.semi_major_axis_km
    j2_state = j2.propagate_eci_datetime(tomorrow)
    assert all(math.isfinite(value) for value in j2_state)
    half_second = timedelta(seconds=0.5)
    before = j2.propagate_eci_datetime(tomorrow - half_second)
    after = j2.propagate_eci_datetime(tomorrow + half_second)
    # The reported velocity must be the derivative of the same J2-secular
    # position, including RAAN/apsidal precession rather than merely n*r.
    for actual, previous, following in zip(j2_state[3:], before[:3], after[:3], strict=True):
        finite_difference = following - previous  # 1 second centred interval.
        assert math.isclose(actual, finite_difference, abs_tol=2e-6)
    assert all(math.isfinite(value) for value in j2.propagate_datetime(tomorrow))


def test_legacy_j2_record_keeps_its_original_engine_instead_of_becoming_cowell():
    """A saved J2 record must not change physics merely by being reopened."""

    request = ManualOrbitRequest(**keplerian_payload(
        propagator="j2",
        propagationOptions={
            # A current client may round-trip its generic controls alongside
            # an old record. They must not implicitly migrate the record.
            "forceTerms": ["central", "j2", "j3", "j4"],
            "numericalIntegrator": "rk4",
        },
    ))
    _, keplerian, state_vector = canonical_manual_orbit(request)

    def resolver(*_args):
        raise AssertionError("A legacy native J2 record must not synthesize a TLE")

    runtime_name, propagator, tle, metadata = build_manual_orbit_propagator(
        request.propagator,
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        resolve_sgp4=resolver,
        propagation_options=request.propagation_options.canonical(
            propagator=request.propagator
        ),
    )

    assert runtime_name.startswith("manual:j2:")
    assert isinstance(propagator, J2Propagator)
    assert not isinstance(propagator, CowellPropagator)
    assert tle is None
    assert metadata["legacy_propagator"] is True
    assert metadata["force_model_id"] == "j2"


def test_direct_builder_projects_stale_cowell_terms_onto_fixed_engines():
    request = ManualOrbitRequest(**keplerian_payload(propagator="two-body"))
    _, keplerian, state_vector = canonical_manual_orbit(request)

    def resolver(*_args):
        raise AssertionError("Los propagadores nativos no deben sintetizar un TLE")

    clean_name, clean_propagator, _tle, _metadata = build_manual_orbit_propagator(
        "two-body",
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        resolve_sgp4=resolver,
    )
    stale_name, stale_propagator, _tle, stale_metadata = build_manual_orbit_propagator(
        "two-body",
        name=request.name,
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        resolve_sgp4=resolver,
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


def test_native_manual_runtime_identity_uses_propagator_epoch_and_state_not_display_name():
    request = ManualOrbitRequest(**keplerian_payload(propagator="two-body"))
    _, keplerian, state_vector = canonical_manual_orbit(request)

    def resolver(*_args):
        raise AssertionError("Los propagadores nativos no deben sintetizar un TLE")

    first_name, first_prop, first_tle, first_metadata = build_manual_orbit_propagator(
        request.propagator,
        name="Same display name",
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        resolve_sgp4=resolver,
    )
    changed_state = {**state_vector, "position_eci_km": {**state_vector["position_eci_km"], "x": 7001}}
    second_name, _, second_tle, _ = build_manual_orbit_propagator(
        request.propagator,
        name="Same display name",
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=changed_state,
        resolve_sgp4=resolver,
    )
    drag_name, drag_propagator, drag_tle, drag_metadata = build_manual_orbit_propagator(
        "cowell-rk4",
        name="Same display name",
        epoch=request.epoch,
        keplerian=keplerian,
        state_vector=state_vector,
        resolve_sgp4=resolver,
        propagation_options={
            "atmospheric_drag": True,
            "cowell_gravity_model": "two-body",
            "numerical_integrator": "rk4",
            "drag_coefficient": 2.2,
            "area_m2": 2.0,
            "mass_kg": 100.0,
        },
    )

    assert isinstance(first_prop, TwoBodyPropagator)
    assert first_name.startswith("manual:two-body:")
    assert first_name != second_name
    assert drag_name != first_name
    assert drag_name.startswith("manual:cowell-rk4:")
    assert isinstance(drag_propagator, CowellPropagator)
    assert drag_tle is None
    assert drag_metadata["applied_engine"] == "cowell-rk4"
    assert drag_metadata["integrator_id"] == "rk4"
    assert "Runge" in drag_metadata["integrator_label"]
    assert first_tle is second_tle is None
    assert first_metadata["id"] == "two-body"
    assert first_metadata["dynamics_reference_frame"] == "ECI"


def test_manual_route_uses_resolver_and_returns_display_named_itrf_ephemeris():
    calls = []

    class FakePropagator: pass

    def resolve_propagator(sat_id, line1, line2, propagator_name):
        calls.append((sat_id, line1, line2, propagator_name))
        return "sgp4:tle:test", FakePropagator()

    def build_ephemeris(name, propagator, start, end, step, include_velocity):
        assert name == "sgp4:tle:test" and isinstance(propagator, FakePropagator)
        assert start.tzinfo is UTC and end > start and step == 30 and include_velocity is True
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

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(horizonHours=2)))

    assert calls and calls[0][0] is None and calls[0][3] == "sgp4"
    assert response["name"] == "Manual test"
    assert response["epochUtc"].endswith("+00:00")
    assert response["ephemeris"]["satellite"] == "Manual test"
    assert response["ephemeris"]["points"][0]["satellite"] == "Manual test"
    assert response["ephemeris"]["points"][0]["reference_frame"] == "ITRF"
    assert response["tle"]["synthetic"] is True
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

    class FakePropagator: pass

    def resolve_propagator(*_args):
        return "sgp4:tle:test", FakePropagator()

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

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
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
        "propagator": "sgp4",
        "applied_engine": "analytical",
        "atmospheric_drag": False,
    }


@pytest.mark.parametrize(
    ("requested_propagator", "expected_type", "canonical", "expected_force_terms"),
    [
        ("two_body", TwoBodyPropagator, "two-body", ["central"]),
        ("j2", J2Propagator, "j2", ["central", "j2"]),
    ],
)
def test_manual_route_uses_native_models_without_synthetic_tle(
    requested_propagator,
    expected_type,
    canonical,
    expected_force_terms,
):
    calls = []

    def resolve_propagator(*_args):
        raise AssertionError("Solo SGP4 debe pasar por el resolvedor TLE")

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

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
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
    assert metadata["label"] == ("Two-body" if canonical == "two-body" else "J2 (first-order secular)")
    assert metadata["dynamics_reference_frame"] == "ECI"
    assert metadata["input_reference_frame"] == "ECI"
    assert metadata["ephemeris_reference_frame"] == "ITRF"
    assert metadata["uses_synthetic_tle"] is False
    assert metadata["eci_samples_available"] is True
    assert metadata["eci_samples_field"] == "ephemeris.points[].eci"
    assert response["propagation_options"] == {
        "force_terms": expected_force_terms,
        "atmospheric_drag": False,
    }
    if canonical == "j2":
        assert metadata["legacy_propagator"] is True
        assert metadata["force_model_id"] == "j2"
        assert metadata["integrator_id"] == "secular-analytic"


def test_manual_route_keeps_j2_j3_j4_as_a_fixed_no_drag_preset():
    calls = []

    def resolve_propagator(*_args):
        raise AssertionError("Native manual propagators do not use TLE")

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

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
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
def test_manual_route_uses_explicit_cowell_for_configurable_drag(force_model, expected_terms, expected_gravity_model):
    calls = []

    def resolve_propagator(*_args):
        raise AssertionError("Native manual propagators do not use TLE")

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
    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")
    response = endpoint(ManualOrbitRequest(**keplerian_payload(
        propagator="cowell-rk4",
        objectMetadata={"objectType": "Satellite", "launchDate": "2026-07-20"},
        propagationOptions=options,
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


def test_manual_route_converts_native_propagation_failure_to_a_correctable_422():
    def resolve_propagator(*_args):
        raise AssertionError("El modelo nativo no debe usar el resolvedor TLE")

    def build_ephemeris(*_args):
        raise ValueError("La propagaciÃ³n intersecta la Tierra")

    router = create_manual_orbits_router(resolve_propagator, build_ephemeris, lambda value: value.astimezone(UTC))
    endpoint = next(route.endpoint for route in router.routes if route.path == "/manual-orbits")

    with pytest.raises(HTTPException) as error:
        endpoint(ManualOrbitRequest(**keplerian_payload(
            propagator="cowell-rk4",
            propagationOptions={"atmosphericDrag": True, "cowellGravityModel": "j2"},
        )))

    assert error.value.status_code == 422
    assert "intersecta" in error.value.detail
