"""Focused regression coverage for propagated osculating-parameter inspection."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import math

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from orbit_api.api.routes.orbit_parameters import create_orbit_parameters_router
from orbit_api.application.manual_orbits import ManualOrbitError
from orbit_api.application.orbit_parameters import OrbitParametersError, build_orbit_parameters
from orbit_api.domain.requests import (
    MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE,
    OrbitParametersRequest,
)
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator


EPOCH = datetime(2026, 7, 20, 12, tzinfo=UTC)


def manual_payload(*, propagator: str = "two-body", options: dict | None = None) -> dict:
    return {
        "name": "Inspector manual",
        "epochUtc": EPOCH.isoformat(),
        "propagator": propagator,
        "keplerian": {
            "semiMajorAxisKm": 7000.0,
            "eccentricity": 0.01,
            "inclinationDeg": 51.6,
            "raanDeg": 20.0,
            "argumentOfPeriapsisDeg": 45.0,
            "trueAnomalyDeg": 15.0,
        },
        **({"propagationOptions": options} if options is not None else {}),
    }


def manual_request(*, propagator: str = "two-body", options: dict | None = None, hours: float = 6.0, samples: int = 4) -> OrbitParametersRequest:
    return OrbitParametersRequest(
        source={"type": "manual", "manualOrbit": manual_payload(propagator=propagator, options=options)},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(hours=hours)).isoformat(),
        samples=samples,
    )


def native_only_resolver(*_args):
    raise AssertionError("Los modelos manuales nativos no deben resolver un TLE")


def test_two_body_inspector_returns_constant_osculating_elements_in_eme2000():
    response = build_orbit_parameters(
        manual_request(hours=3, samples=3),
        resolve_propagator=native_only_resolver,
    )

    assert response["reference_frame"] == "EME2000"
    assert response["element_type"] == "osculating"
    assert response["model"]["id"] == "two-body"
    assert response["count"] == response["samples_requested"] == 3
    first, middle, last = response["samples"]
    assert first["reference_frame"] == first["state"]["reference_frame"] == "EME2000"
    assert response["model"]["state_reference_frame"] == "EME2000"
    assert response["model"]["state_source"] == "native_manual_eme2000"
    assert first["elements"]["element_type"] == "osculating"
    assert math.isclose(first["elements"]["semi_major_axis_km"], 7000.0, abs_tol=1e-7)
    assert math.isclose(middle["elements"]["semi_major_axis_km"], first["elements"]["semi_major_axis_km"], abs_tol=1e-6)
    assert math.isclose(last["elements"]["eccentricity"], first["elements"]["eccentricity"], abs_tol=1e-9)
    assert first["elements"]["perigee_altitude_km"] < first["elements"]["apogee_altitude_km"]
    assert first["elements"]["mean_motion_rev_day"] > 0.0


def test_inspector_keeps_legacy_manual_sgp4_readable_but_rejects_execution():
    request = manual_request(
        propagator="sgp4",
        options={"atmosphericDrag": True},
    )

    # A project record can be parsed for identification, but no synthetic TLE
    # is built and the catalogue resolver is never invoked.
    assert request.source.manual_orbit is not None
    assert request.source.manual_orbit.propagator == "sgp4"
    with pytest.raises(ManualOrbitError, match="SGP4 no está disponible"):
        build_orbit_parameters(
            request,
            resolve_propagator=native_only_resolver,
        )

    router = create_orbit_parameters_router(
        native_only_resolver,
        lambda value: value.astimezone(UTC),
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/orbit-parameters")
    with pytest.raises(HTTPException) as rejected:
        endpoint(request)

    assert rejected.value.status_code == 422
    assert rejected.value.detail == MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE


def test_inspector_reports_only_forces_applied_by_a_fixed_manual_engine():
    response = build_orbit_parameters(
        manual_request(
            propagator="two-body",
            options={
                # A stale project payload must not cause the inspector to
                # describe unapplied Cowell zonal terms.
                "forceTerms": ["central", "j2", "j3", "j4"],
                "numericalIntegrator": "rk4",
            },
        ),
        resolve_propagator=native_only_resolver,
    )

    assert response["model"]["id"] == "two-body"
    assert response["source"]["propagation_options"] == {
        "force_terms": ["central"],
        "atmospheric_drag": False,
    }


def test_cowell_j2_inspector_exposes_precessing_osculating_raan():
    response = build_orbit_parameters(
        manual_request(
            propagator="cowell-rk4",
            options={"forceTerms": ["central", "j2"]},
            hours=24,
            samples=2,
        ),
        resolve_propagator=native_only_resolver,
    )

    initial = response["samples"][0]["elements"]
    final = response["samples"][-1]["elements"]
    assert response["reference_frame"] == "EME2000"
    assert response["model"]["id"] == "cowell-rk4"
    assert response["model"]["applied_engine"] == "cowell-rk4"
    assert response["model"]["force_terms"] == ["central", "j2"]
    assert not math.isclose(initial["raan_deg"], final["raan_deg"], abs_tol=1e-4)
    # The inspector derives *osculating* values from the full precessing
    # state, so its instantaneous a is not required to equal the analytic
    # J2 model's stored mean element exactly; it must remain physical.
    assert initial["semi_major_axis_km"] > 6378.0
    assert final["semi_major_axis_km"] > 6378.0


def test_j2_j3_j4_manual_inspection_uses_native_eme2000_samples():
    response = build_orbit_parameters(
        manual_request(propagator="j2-j3-j4", hours=1, samples=2),
        resolve_propagator=native_only_resolver,
    )

    assert response["reference_frame"] == "EME2000"
    assert response["model"]["id"] == "j2-j3-j4"
    assert response["model"]["applied_engine"] == "j2-j3-j4"
    assert response["model"]["atmospheric_drag_supported"] is False
    assert all(math.isfinite(row["elements"]["speed_km_s"]) for row in response["samples"])


def test_j2_j3_j4_keeps_its_own_numerical_inspector_budget():
    # This fixed zonal-gravity preset shares the bounded RK4 implementation,
    # but must never be mislabeled as the configurable Cowell/RK4 engine.
    with pytest.raises(OrbitParametersError, match=r"J2 \+ J3 \+ J4"):
        build_orbit_parameters(
            manual_request(propagator="j2-j3-j4", hours=121, samples=2),
            resolve_propagator=native_only_resolver,
        )


def test_cowell_inspector_rejects_ranges_beyond_its_internal_step_budget():
    # Cowell/RK4 is the configurable numerical propagator. The request is
    # rejected before allowing an unbounded number of force evaluations.
    with pytest.raises(OrbitParametersError, match="Cowell/RK4") as rejected:
        build_orbit_parameters(
            manual_request(propagator="cowell-rk4", hours=121, samples=2),
            resolve_propagator=native_only_resolver,
        )

    assert "Reduce el intervalo" in str(rejected.value)


def test_cowell_inspector_counts_distance_from_epoch_not_only_range_width():
    # A one-hour range can still be expensive when it starts far from the
    # manual epoch, because Cowell has to integrate from that epoch first.
    request = manual_request(propagator="cowell-rk4", hours=1, samples=2).model_copy(
        update={
            "start_time": EPOCH + timedelta(hours=121),
            "end_time": EPOCH + timedelta(hours=122),
        }
    )

    with pytest.raises(OrbitParametersError, match="Cowell/RK4"):
        build_orbit_parameters(request, resolve_propagator=native_only_resolver)


def test_cowell_inspector_budget_includes_dense_sample_cost():
    # With a dense sample set, each sub-minute/non-aligned segment may become
    # a shortened RK4 step.  The physical envelope alone would underestimate
    # the actual work in that case.
    with pytest.raises(OrbitParametersError, match="Cowell/RK4"):
        build_orbit_parameters(
            manual_request(propagator="cowell-rk4", hours=119, samples=2_000),
            resolve_propagator=native_only_resolver,
        )


def test_route_maps_cowell_inspector_budget_to_actionable_422():
    router = create_orbit_parameters_router(
        native_only_resolver,
        lambda value: value.astimezone(UTC),
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/orbit-parameters")

    with pytest.raises(HTTPException) as rejected:
        endpoint(manual_request(propagator="cowell-rk4", hours=121, samples=2))

    assert rejected.value.status_code == 422
    assert "Cowell/RK4" in rejected.value.detail


def test_cowell_drag_on_and_off_show_a_measurable_leo_decay_difference():
    # 250 km with an intentionally visible ballistic factor makes the
    # non-conservative drag model measurable in a short, deterministic test.
    payload = manual_payload(
        propagator="cowell-rk4",
        options={
            "atmosphericDrag": True,
            "cowellGravityModel": "two-body",
            "dragCoefficient": 2.2,
            "areaM2": 8.0,
            "massKg": 250.0,
        },
    )
    payload["keplerian"] = {
        "semiMajorAxisKm": 6628.0,
        "eccentricity": 0.0,
        "inclinationDeg": 51.6,
        "raanDeg": 20.0,
        "argumentOfPeriapsisDeg": 0.0,
        "trueAnomalyDeg": 0.0,
    }
    request = OrbitParametersRequest(
        source={"kind": "manual", "manualOrbit": payload},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(hours=6)).isoformat(),
        samples=3,
    )
    with_drag = build_orbit_parameters(request, resolve_propagator=native_only_resolver)
    without_drag_payload = {
        **payload,
        "propagationOptions": {**payload["propagationOptions"], "atmosphericDrag": False},
    }
    without_drag = build_orbit_parameters(
        OrbitParametersRequest(
            source={"kind": "manual", "manualOrbit": without_drag_payload},
            startTime=EPOCH.isoformat(),
            endTime=(EPOCH + timedelta(hours=6)).isoformat(),
            samples=3,
        ),
        resolve_propagator=native_only_resolver,
    )

    initial = with_drag["samples"][0]["elements"]["semi_major_axis_km"]
    final = with_drag["samples"][-1]["elements"]["semi_major_axis_km"]
    no_drag_initial = without_drag["samples"][0]["elements"]["semi_major_axis_km"]
    no_drag_final = without_drag["samples"][-1]["elements"]["semi_major_axis_km"]
    drag_decay_km = initial - final
    no_drag_decay_km = no_drag_initial - no_drag_final

    assert with_drag["model"]["applied_engine"] == "cowell-rk4"
    assert with_drag["model"]["force_model_id"] == "two-body"
    assert with_drag["model"]["force_terms"] == ["central", "drag"]
    assert without_drag["model"]["force_terms"] == ["central"]
    assert with_drag["source"]["propagation_options"]["atmospheric_drag"] is True
    assert without_drag["source"]["propagation_options"]["atmospheric_drag"] is False
    assert drag_decay_km > 0.1
    assert drag_decay_km > no_drag_decay_km + 0.1


def test_cowell_drag_is_negligible_for_the_same_ballistic_body_at_1000_km():
    payload = manual_payload(
        propagator="cowell-rk4",
        options={
            "atmosphericDrag": True,
            "cowellGravityModel": "two-body",
            "dragCoefficient": 2.2,
            "areaM2": 8.0,
            "massKg": 250.0,
        },
    )
    payload["keplerian"] = {
        "semiMajorAxisKm": 7378.0,
        "eccentricity": 0.0,
        "inclinationDeg": 51.6,
        "raanDeg": 20.0,
        "argumentOfPeriapsisDeg": 0.0,
        "trueAnomalyDeg": 0.0,
    }
    request_fields = {
        "startTime": EPOCH.isoformat(),
        "endTime": (EPOCH + timedelta(hours=12)).isoformat(),
        "samples": 2,
    }
    with_drag = build_orbit_parameters(
        OrbitParametersRequest(source={"kind": "manual", "manualOrbit": payload}, **request_fields),
        resolve_propagator=native_only_resolver,
    )
    without_drag_payload = {
        **payload,
        "propagationOptions": {**payload["propagationOptions"], "atmosphericDrag": False},
    }
    without_drag = build_orbit_parameters(
        OrbitParametersRequest(source={"kind": "manual", "manualOrbit": without_drag_payload}, **request_fields),
        resolve_propagator=native_only_resolver,
    )

    final_with_drag = with_drag["samples"][-1]["elements"]["semi_major_axis_km"]
    final_without_drag = without_drag["samples"][-1]["elements"]["semi_major_axis_km"]
    assert abs(final_with_drag - final_without_drag) < 0.05


def test_catalog_sgp4_inspection_keeps_the_raw_teme_label():
    line1 = "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991"
    line2 = "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000"
    propagator = SGP4Propagator(line1, line2)

    def resolver(sat_id, supplied_line1, supplied_line2, *_args):
        assert sat_id is None and supplied_line1 == line1 and supplied_line2 == line2
        return "ISS", propagator

    start = datetime(2024, 1, 1, tzinfo=UTC)
    request = OrbitParametersRequest(
        source={"type": "catalog", "line1": line1, "line2": line2},
        startTime=start.isoformat(),
        endTime=(start + timedelta(minutes=20)).isoformat(),
        samples=2,
    )
    response = build_orbit_parameters(request, resolve_propagator=resolver)

    expected_teme = propagator.propagate_teme_datetime(start)
    actual = response["samples"][0]
    assert response["reference_frame"] == actual["reference_frame"] == "TEME"
    assert response["model"]["state_source"] == "raw_sgp4_teme"
    assert response["model"]["central_body_mu_km3_s2"] == pytest.approx(propagator.sat.mu)
    assert actual["state"]["reference_frame"] == actual["elements"]["reference_frame"] == "TEME"
    assert actual["elements"]["central_body_mu_km3_s2"] == pytest.approx(propagator.sat.mu)
    assert math.isclose(actual["state"]["position"]["x"], expected_teme[0], abs_tol=1e-9)
    assert actual["state"]["position"]["x"] != pytest.approx(propagator.propagate_datetime(start)[0] / 1000.0)


def test_request_contract_accepts_direct_sources_and_rejects_invalid_ranges_and_samples():
    direct_catalog = OrbitParametersRequest(
        satId="ISS",
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(hours=1)).isoformat(),
        sampleCount=3,
    )
    assert direct_catalog.source.kind == "catalog"
    assert direct_catalog.source.sat_id == "ISS"
    assert direct_catalog.samples == 3

    with pytest.raises(ValidationError, match="end_time debe ser mayor"):
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "ISS"},
            startTime=EPOCH.isoformat(),
            endTime=EPOCH.isoformat(),
        )
    with pytest.raises(ValidationError):
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "ISS"},
            startTime=EPOCH.isoformat(),
            endTime=(EPOCH + timedelta(hours=1)).isoformat(),
            samples=2_001,
        )


def test_route_preserves_resolver_4xx_and_converts_unsupported_state_to_422():
    router = create_orbit_parameters_router(
        lambda *_args: (_ for _ in ()).throw(HTTPException(status_code=404, detail="not found")),
        lambda value: value.astimezone(UTC),
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/orbit-parameters")
    payload = OrbitParametersRequest(
        source={"kind": "catalog", "satId": "UNKNOWN"},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(hours=1)).isoformat(),
        samples=2,
    )
    with pytest.raises(HTTPException) as missing:
        endpoint(payload)
    assert missing.value.status_code == 404

    unsupported_router = create_orbit_parameters_router(
        lambda *_args: ("broken", object()),
        lambda value: value.astimezone(UTC),
    )
    unsupported_endpoint = next(route.endpoint for route in unsupported_router.routes if route.path == "/orbit-parameters")
    with pytest.raises(HTTPException) as unsupported:
        unsupported_endpoint(payload.model_copy(update={"source": payload.source.model_copy(update={"sat_id": "BROKEN"})}))
    assert unsupported.value.status_code == 422
    assert "TEME" in unsupported.value.detail
