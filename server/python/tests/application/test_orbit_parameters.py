"""Focused regression coverage for propagated osculating-parameter inspection."""

from __future__ import annotations

import base64
import math
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from orbit_api.api.routes.orbit_parameters import create_orbit_parameters_router
from orbit_api.application.manual_erp import ManualErpRepository
from orbit_api.application.manual_orbits import ManualOrbitError
from orbit_api.application.orbit_parameters import (
    OrbitParametersError,
    build_orbit_parameters,
)
from orbit_api.domain.requests import (
    MANUAL_ORBIT_SGP4_UNAVAILABLE_MESSAGE,
    ORBIT_PARAMETERS_MAX_SAMPLES,
    OrbitParametersRequest,
)
from orbit_api.formats import OemStateProvider
from orbit_api.formats.tabular import TabularStateProvider
from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.orbits.forces import GravityFieldModel
from orbit_api.orbits.propagators.sgp4.propagator import SGP4Propagator
from orbit_api.timekeeping import (
    EarthOrientation,
    LeapSecondTable,
    StaticEarthOrientationProvider,
)
from pydantic import ValidationError

EPOCH = datetime(2026, 7, 20, 12, tzinfo=UTC)


def strict_force_transformer() -> FrameTransformService:
    """Provide deterministic EOP/leap data for Earth-fixed drag tests."""

    return FrameTransformService(
        StaticEarthOrientationProvider(
            EarthOrientation(
                dut1_seconds=0.17,
                xp_radians=1.0e-6,
                yp_radians=-0.8e-6,
                source="orbit-parameters drag fixture",
                version="r1",
                quality="final",
            )
        ),
        strict_eop=True,
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="fixture leap seconds",
            version="fixture-2025",
            sha256="b" * 64,
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        ),
    )


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


def _manual_erp_text() -> str:
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


def _with_manual_erp(payload: dict, snapshot) -> dict:
    return {**payload, "manualErp": {"snapshotId": snapshot.snapshot_id}}


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


def test_cowell_budget_rejects_a_full_resolution_year_without_materialising_a_huge_cache():
    # Analytical sources may request every minute of the supported one-year
    # inspector range. A native fixed-step RK4 model still has its own force
    # evaluation budget and must reject that impossible request immediately,
    # rather than constructing an O(n²) ordered cache just to report it.
    with pytest.raises(OrbitParametersError, match="al menos 7,201 pasos"):
        build_orbit_parameters(
            manual_request(propagator="cowell-rk4", hours=365 * 24, samples=525_601),
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


def test_cowell_drag_on_and_off_show_a_measurable_leo_decay_difference(manual_erp_snapshot):
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
    repository, erp = manual_erp_snapshot
    request = OrbitParametersRequest(
        source={"kind": "manual", "manualOrbit": _with_manual_erp(payload, erp)},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(hours=6)).isoformat(),
        samples=3,
    )
    frame_transformer = strict_force_transformer()
    with_drag = build_orbit_parameters(
        request,
        resolve_propagator=native_only_resolver,
        frame_transformer=frame_transformer,
        manual_erp_repository=repository,
    )
    without_drag_payload = {
        **payload,
        "propagationOptions": {**payload["propagationOptions"], "atmosphericDrag": False},
    }
    without_drag = build_orbit_parameters(
        OrbitParametersRequest(
            source={"kind": "manual", "manualOrbit": _with_manual_erp(without_drag_payload, erp)},
            startTime=EPOCH.isoformat(),
            endTime=(EPOCH + timedelta(hours=6)).isoformat(),
            samples=3,
        ),
        resolve_propagator=native_only_resolver,
        frame_transformer=frame_transformer,
        manual_erp_repository=repository,
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


def test_cowell_drag_is_negligible_for_the_same_ballistic_body_at_1000_km(manual_erp_snapshot):
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
    frame_transformer = strict_force_transformer()
    repository, erp = manual_erp_snapshot
    with_drag = build_orbit_parameters(
        OrbitParametersRequest(source={"kind": "manual", "manualOrbit": _with_manual_erp(payload, erp)}, **request_fields),
        resolve_propagator=native_only_resolver,
        frame_transformer=frame_transformer,
        manual_erp_repository=repository,
    )
    without_drag_payload = {
        **payload,
        "propagationOptions": {**payload["propagationOptions"], "atmosphericDrag": False},
    }
    without_drag = build_orbit_parameters(
        OrbitParametersRequest(source={"kind": "manual", "manualOrbit": _with_manual_erp(without_drag_payload, erp)}, **request_fields),
        resolve_propagator=native_only_resolver,
        frame_transformer=frame_transformer,
        manual_erp_repository=repository,
    )

    final_with_drag = with_drag["samples"][-1]["elements"]["semi_major_axis_km"]
    final_without_drag = without_drag["samples"][-1]["elements"]["semi_major_axis_km"]
    assert abs(final_with_drag - final_without_drag) < 0.05


def test_inspector_rebuilds_a_configured_geopotential_manual_orbit(manual_erp_snapshot):
    payload = manual_payload(
        propagator="cowell-rk4",
        options={
            "forceTerms": ["geopotential"],
            "geopotentialDegree": 4,
            "geopotentialOrder": 0,
        },
    )
    repository, erp = manual_erp_snapshot
    response = build_orbit_parameters(
        OrbitParametersRequest(
            source={"kind": "manual", "manualOrbit": _with_manual_erp(payload, erp)},
            startTime=EPOCH.isoformat(),
            endTime=(EPOCH + timedelta(minutes=2)).isoformat(),
            samples=2,
        ),
        resolve_propagator=native_only_resolver,
        frame_transformer=strict_force_transformer(),
        gravity_field=GravityFieldModel.wgs84_zonal_degree4(),
        manual_erp_repository=repository,
    )

    assert response["model"]["force_terms"] == ["central", "geopotential"]
    assert response["model"]["geopotential"]["evaluation_frame"] == "ITRF"


def test_manual_inspector_preserves_runtime_published_acceleration(monkeypatch):
    """A numerical runtime may publish acceleration; the inspector must not drop it."""

    class AcceleratingCowellRuntime:
        def native_state_at(self, instant: datetime) -> StateVector:
            return StateVector(
                epoch=instant,
                time_scale="UTC",
                frame=FrameId.EME2000,
                frame_realization=None,
                center="EARTH",
                position_m=(7_000_000.0, 0.0, 0.0),
                velocity_m_s=(0.0, 7_500.0, 1_000.0),
                acceleration_m_s2=(-8.1, 0.02, -0.03),
                provenance={
                    "source": "manual",
                    "propagator": "cowell-rk4",
                    "acceleration_source": "runtime-force-evaluation",
                },
            )

    def build_accelerating_runtime(*_args, **_kwargs):
        return (
            "manual:cowell-acceleration-fixture",
            AcceleratingCowellRuntime(),
            {
                "id": "cowell-rk4",
                "label": "Cowell numerical propagation",
                "applied_engine": "cowell-rk4",
                "force_terms": ["central"],
                "inspector_requires_numerical_budget": False,
            },
        )

    monkeypatch.setattr(
        "orbit_api.application.orbit_parameters.build_manual_orbit_propagator",
        build_accelerating_runtime,
    )

    response = build_orbit_parameters(
        manual_request(propagator="cowell-rk4", hours=1, samples=2),
        resolve_propagator=native_only_resolver,
    )

    for sample in response["samples"]:
        state = sample["state"]
        assert state["acceleration_units"] == "km/s^2"
        assert state["acceleration"] == pytest.approx({
            "x": -0.0081,
            "y": 0.00002,
            "z": -0.00003,
        })
        assert state["provenance"]["acceleration_source"] == "runtime-force-evaluation"


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
    assert "acceleration" not in actual["state"]
    assert "acceleration_units" not in actual["state"]


def test_manual_inspector_transforms_table_states_without_relabelling_native_elements():
    request = OrbitParametersRequest(
        source={"type": "manual", "manualOrbit": manual_payload()},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(minutes=10)).isoformat(),
        samples=2,
        outputFrame="ITRF",
    )

    response = build_orbit_parameters(
        request,
        resolve_propagator=native_only_resolver,
        frame_transformer=strict_force_transformer(),
    )

    first = response["samples"][0]
    frame = response["capabilities"]["inspector"]["frame"]
    assert response["native_reference_frame"] == "EME2000"
    assert response["reference_frame"] == response["output_reference_frame"] == "ITRF"
    assert response["model"]["state_reference_frame"] == "EME2000"
    assert first["native_reference_frame"] == "EME2000"
    assert first["state"]["reference_frame"] == "ITRF"
    # The table is terrestrial, but the osculating calculation deliberately
    # stays in the native inertial state rather than being mislabelled ITRF.
    assert first["elements"]["reference_frame"] == "EME2000"
    assert first["osculating_elements"] == {
        "available": True,
        "calculation_reference_frame": "EME2000",
        "calculation_state": "native",
    }
    assert first["frame_transform"]["applied"] is True
    assert first["state"]["provenance"]["frame_transform"]["source_frame"] == "EME2000"
    assert frame["native"]["reference_frame"] == "EME2000"
    assert frame["current"]["reference_frame"] == "ITRF"
    assert frame["output"]["requested_frame"] == "ITRF"
    assert frame["output"]["provenance"]["target_frame"] == "ITRF"
    assert frame["selectable"] is True
    assert frame["available_output_frames"] == [
        "TEME", "ITRF", "EME2000", "GCRF", "ICRF"
    ]


def test_requested_output_frame_requires_a_real_transform_service():
    request = OrbitParametersRequest(
        source={"type": "manual", "manualOrbit": manual_payload()},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(minutes=10)).isoformat(),
        samples=2,
        outputFrame="ITRF",
    )

    with pytest.raises(OrbitParametersError, match="FrameTransformService"):
        build_orbit_parameters(
            request,
            resolve_propagator=native_only_resolver,
        )


def test_requested_output_frame_reports_strict_eop_failures_actionably():
    unavailable_eop_transformer = FrameTransformService(
        StaticEarthOrientationProvider(
            EarthOrientation(
                dut1_seconds=0.17,
                xp_radians=1.0e-6,
                yp_radians=-0.8e-6,
                source="unusable output-frame fixture",
                version="r1",
                quality="predicted",
            )
        ),
        strict_eop=True,
        leap_second_table=LeapSecondTable(
            entries=((datetime(2025, 1, 1, tzinfo=UTC), 38),),
            source="fixture leap seconds",
            version="fixture-2025",
            sha256="b" * 64,
            expires_at=datetime(2027, 1, 1, tzinfo=UTC),
        ),
    )
    request = OrbitParametersRequest(
        source={"type": "manual", "manualOrbit": manual_payload()},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(minutes=10)).isoformat(),
        samples=2,
        outputFrame="ITRF",
    )

    with pytest.raises(OrbitParametersError, match="No se pudo transformar") as rejected:
        build_orbit_parameters(
            request,
            resolve_propagator=native_only_resolver,
            frame_transformer=unavailable_eop_transformer,
        )

    assert "calidad final o rapid" in str(rejected.value)


def test_catalog_tle_output_frame_transforms_the_table_but_keeps_teme_elements():
    line1 = "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991"
    line2 = "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000"
    propagator = SGP4Propagator(line1, line2)
    request = OrbitParametersRequest(
        source={"type": "catalog", "line1": line1, "line2": line2},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(minutes=10)).isoformat(),
        samples=2,
        outputFrame="ITRF",
    )

    response = build_orbit_parameters(
        request,
        resolve_propagator=lambda *_args: ("ISS", propagator),
        frame_transformer=strict_force_transformer(),
    )

    first = response["samples"][0]
    assert response["native_reference_frame"] == "TEME"
    assert response["reference_frame"] == "ITRF"
    assert first["state"]["reference_frame"] == "ITRF"
    assert first["elements"]["reference_frame"] == "TEME"
    assert first["frame_transform"]["applied"] is True


def test_tabular_sp3_can_use_a_verified_inertial_output_for_osculating_elements():
    start = EPOCH
    provider = TabularStateProvider(
        source_format="SP3",
        samples=(
            StateVector.from_kilometres(
                epoch=start,
                time_scale="UTC",
                frame=FrameId.ITRF,
                frame_realization=None,
                center="EARTH",
                position_km=(20_000.0, 1_000.0, -2_000.0),
                velocity_km_s=(0.1, 3.0, 2.0),
                provenance={"source_format": "SP3"},
            ),
            StateVector.from_kilometres(
                epoch=start + timedelta(minutes=15),
                time_scale="UTC",
                frame=FrameId.ITRF,
                frame_realization=None,
                center="EARTH",
                position_km=(20_100.0, 3_700.0, -200.0),
                velocity_km_s=(0.1, 3.0, 2.0),
                provenance={"source_format": "SP3"},
            ),
        ),
        declared_interpolation="LINEAR",
        declared_interpolation_degree=1,
    )
    request = OrbitParametersRequest(
        source={"kind": "catalog", "satId": "precise:fixture:G01"},
        startTime=start.isoformat(),
        endTime=(start + timedelta(minutes=15)).isoformat(),
        samples=2,
        outputFrame="GCRF",
    )

    response = build_orbit_parameters(
        request,
        resolve_propagator=lambda *_args: ("G01 fixture", provider),
        frame_transformer=strict_force_transformer(),
    )

    first = response["samples"][0]
    inspector = response["capabilities"]["inspector"]
    assert response["native_reference_frame"] == "ITRF"
    assert response["reference_frame"] == "GCRF"
    assert response["model"]["state_reference_frame"] == "ITRF"
    assert response["element_type"] == "osculating"
    assert first["state"]["reference_frame"] == "GCRF"
    assert first["elements"]["reference_frame"] == "GCRF"
    assert first["osculating_elements"]["calculation_state"] == "output"
    assert first["frame_transform"]["provenance"]["source_frame"] == "ITRF"
    assert inspector["output_cartesian"]["reference_frame"] == "GCRF"
    assert inspector["osculating_elements"]["reference_frame"] == "GCRF"


def test_catalog_omm_provenance_is_preserved_while_sgp4_remains_the_applied_engine():
    line1 = "1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9991"
    line2 = "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000"
    propagator = SGP4Propagator(line1, line2)
    start = datetime(2024, 1, 1, tzinfo=UTC)
    response = build_orbit_parameters(
        OrbitParametersRequest(
            source={"kind": "catalog", "line1": line1, "line2": line2, "sourceFormat": "OMM"},
            startTime=start.isoformat(),
            endTime=(start + timedelta(minutes=20)).isoformat(),
            samples=2,
        ),
        resolve_propagator=lambda *_args: ("ISS OMM", propagator),
    )

    assert response["source"]["source_format"] == "OMM"
    assert response["model"]["id"] == "sgp4"
    assert response["model"]["input_source_format"] == "OMM"
    assert response["model"]["state_source"] == "raw_sgp4_teme"


def test_catalog_tabular_sp3_returns_native_cartesian_without_terrestrial_elements():
    start = datetime(2026, 7, 20, 12, tzinfo=UTC)
    provider = TabularStateProvider(
        source_format="SP3",
        samples=(
            StateVector.from_kilometres(
                epoch=start,
                time_scale="UTC",
                frame=FrameId.ITRF,
                frame_realization="IGS20",
                center="EARTH",
                position_km=(20_000.0, 1_000.0, -2_000.0),
                velocity_km_s=(0.1, 3.0, 2.0),
                provenance={"source_format": "SP3", "agency": "fixture"},
            ),
            StateVector.from_kilometres(
                epoch=start + timedelta(minutes=15),
                time_scale="UTC",
                frame=FrameId.ITRF,
                frame_realization="IGS20",
                center="EARTH",
                position_km=(20_100.0, 3_700.0, -200.0),
                velocity_km_s=(0.1, 3.0, 2.0),
                provenance={"source_format": "SP3", "agency": "fixture"},
            ),
        ),
        declared_interpolation="LINEAR",
        declared_interpolation_degree=1,
    )

    def resolver(sat_id, supplied_line1, supplied_line2, *_args):
        assert sat_id == "precise:fixture:G01"
        assert supplied_line1 is None and supplied_line2 is None
        return "G01 fixture", provider

    response = build_orbit_parameters(
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "precise:fixture:G01"},
            startTime=start.isoformat(),
            endTime=(start + timedelta(minutes=15)).isoformat(),
            samples=2,
        ),
        resolve_propagator=resolver,
    )

    first = response["samples"][0]
    assert response["source"]["source_format"] == "SP3"
    assert response["reference_frame"] == "IGS20"
    assert response["element_type"] == first["element_type"] == "native-cartesian"
    assert response["model"]["id"] == "tabular-sp3"
    assert response["model"]["state_source"] == "native_tabular_state"
    assert response["model"]["interpolation"]["method"] == "LINEAR"
    assert response["capabilities"]["inspector"]["mode"] == "native-cartesian"
    assert response["capabilities"]["inspector"]["osculating_elements"]["available"] is False
    assert first["state"]["reference_frame"] == "IGS20"
    assert first["state"]["position"]["x"] == pytest.approx(20_000.0)
    assert first["state"]["velocity"]["y"] == pytest.approx(3.0)
    assert first["state"]["provenance"]["source_format"] == "SP3"
    assert "elements" not in first
    assert first["osculating_elements"]["available"] is False


def test_catalog_tabular_oem_derives_elements_only_for_complete_inertial_states():
    start = datetime(2026, 7, 20, 12, tzinfo=UTC)
    provider = TabularStateProvider(
        source_format="OEM",
        samples=(
            StateVector.from_kilometres(
                epoch=start,
                time_scale="UTC",
                frame=FrameId.EME2000,
                frame_realization=None,
                center="EARTH",
                position_km=(7_000.0, 0.0, 0.0),
                velocity_km_s=(0.0, 7.5, 1.0),
                provenance={"source_format": "OEM", "segment_index": 0},
            ),
            StateVector.from_kilometres(
                epoch=start + timedelta(minutes=10),
                time_scale="UTC",
                frame=FrameId.EME2000,
                frame_realization=None,
                center="EARTH",
                position_km=(5_600.0, 4_200.0, 600.0),
                velocity_km_s=(-4.5, 6.0, 0.8),
                provenance={"source_format": "OEM", "segment_index": 0},
            ),
        ),
        declared_interpolation="LINEAR",
        declared_interpolation_degree=1,
    )

    response = build_orbit_parameters(
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "oem:fixture"},
            startTime=start.isoformat(),
            endTime=(start + timedelta(minutes=10)).isoformat(),
            samples=2,
        ),
        resolve_propagator=lambda *_args: ("OEM fixture", provider),
    )

    assert response["source"]["source_format"] == "OEM"
    assert response["element_type"] == "osculating"
    assert response["capabilities"]["inspector"]["mode"] == "native-cartesian-and-osculating"
    assert response["capabilities"]["inspector"]["osculating_elements"]["available"] is True
    assert response["samples"][0]["elements"]["reference_frame"] == "EME2000"


def _multi_segment_oem_provider() -> OemStateProvider:
    """A real OEM adapter, not a flattened TabularStateProvider test double."""

    return OemStateProvider.from_text(
        """
CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-07-20T00:00:00Z
ORIGINATOR = Orbit test fixture

META_START
OBJECT_NAME = SEGMENT ZERO
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = ITRF2020
TIME_SYSTEM = UTC
START_TIME = 2026-07-20T12:00:00Z
STOP_TIME = 2026-07-20T12:01:00Z
INTERPOLATION = LINEAR
INTERPOLATION_DEGREE = 1
META_STOP
2026-07-20T12:00:00Z 7000.0 0.0 0.0 0.0 7.5 1.0
2026-07-20T12:01:00Z 6999.0 450.0 60.0 -0.5 7.48 1.0

META_START
OBJECT_NAME = SEGMENT ONE
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-07-20T12:02:00Z
STOP_TIME = 2026-07-20T12:03:00Z
INTERPOLATION = LINEAR
INTERPOLATION_DEGREE = 1
META_STOP
2026-07-20T12:02:00Z 7000.0 0.0 0.0 0.0 7.5 1.0 0.001 0.0 0.0
2026-07-20T12:03:00Z 6999.0 450.0 60.0 -0.5 7.48 1.0 0.001 0.0 0.0
COVARIANCE_START
EPOCH = 2026-07-20T12:02:00Z
1.0
2.0 3.0
4.0 5.0 6.0
7.0 8.0 9.0 10.0
11.0 12.0 13.0 14.0 15.0
16.0 17.0 18.0 19.0 20.0 21.0
COVARIANCE_STOP
"""
    )


def test_catalog_oem_provider_requires_explicit_segment_and_preserves_native_contract():
    provider = _multi_segment_oem_provider()
    start = datetime(2026, 7, 20, 12, 2, tzinfo=UTC)
    end = start + timedelta(minutes=1)

    request = OrbitParametersRequest(
        source={"kind": "catalog", "satId": "oem:multi", "segmentIndex": 1},
        startTime=start.isoformat(),
        endTime=end.isoformat(),
        samples=2,
    )
    assert request.source.segment_index == 1

    response = build_orbit_parameters(
        request,
        resolve_propagator=lambda *_args: ("OEM multi-segment fixture", provider),
    )

    first, last = response["samples"]
    assert response["source"]["source_format"] == "OEM"
    assert response["source"]["segment_index"] == 1
    assert response["source"]["oem"]["segment_count"] == 2
    assert response["source"]["oem"]["segment_index"] == 1
    assert response["source"]["oem"]["reference_frame"] == "EME2000"
    assert response["model"]["interpolation"]["method"] == "LINEAR"
    assert response["model"]["oem"]["covariance"] == {
        "available": True,
        "record_count": 1,
        "attachment": "exact-epoch-only",
        "epochs": [start.isoformat()],
    }
    assert response["reference_frame"] == "EME2000"
    assert (
        response["capabilities"]["inspector"]["mode"]
        == "native-cartesian-and-osculating"
    )
    assert first["state"]["acceleration"]["x"] == pytest.approx(0.001)
    assert first["state"]["covariance_units"] == "SI-state-vector"
    assert first["state"]["covariance"][0][0] == pytest.approx(1_000_000.0)
    assert first["state"]["provenance"]["oem_covariance"]["attached"] is True
    assert last["state"]["provenance"]["oem_covariance"]["attached"] is False

    with pytest.raises(OrbitParametersError, match="source.segmentIndex"):
        build_orbit_parameters(
            OrbitParametersRequest(
                source={"kind": "catalog", "satId": "oem:multi"},
                startTime=start.isoformat(),
                endTime=end.isoformat(),
                samples=2,
            ),
            resolve_propagator=lambda *_args: ("OEM multi-segment fixture", provider),
        )

    with pytest.raises(OrbitParametersError, match="unico segmento OEM"):
        build_orbit_parameters(
            OrbitParametersRequest(
                source={"kind": "catalog", "satId": "oem:multi", "segmentIndex": 0},
                startTime=(start - timedelta(minutes=2)).isoformat(),
                endTime=end.isoformat(),
                samples=2,
            ),
            resolve_propagator=lambda *_args: ("OEM multi-segment fixture", provider),
        )


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

    output_frame_request = OrbitParametersRequest(
        source={"kind": "catalog", "satId": "ISS"},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(hours=1)).isoformat(),
        outputFrame="gcrf",
    )
    assert output_frame_request.output_frame == "GCRF"

    with pytest.raises(ValidationError, match="output_frame"):
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "ISS"},
            startTime=EPOCH.isoformat(),
            endTime=(EPOCH + timedelta(hours=1)).isoformat(),
            outputFrame="ECI",
        )

    with pytest.raises(ValidationError, match="end_time debe ser mayor"):
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "ISS"},
            startTime=EPOCH.isoformat(),
            endTime=EPOCH.isoformat(),
        )
    # A one-minute cadence across a full 365-day UI range requires 525,601
    # endpoint-inclusive samples. The request contract accepts that complete
    # operator-selected series rather than silently forcing the old 121/2000
    # point display caps.
    full_year_minute_cadence = OrbitParametersRequest(
        source={"kind": "catalog", "satId": "ISS"},
        startTime=EPOCH.isoformat(),
        endTime=(EPOCH + timedelta(days=365)).isoformat(),
        samples=525_601,
    )
    assert full_year_minute_cadence.samples == 525_601

    with pytest.raises(ValidationError):
        OrbitParametersRequest(
            source={"kind": "catalog", "satId": "ISS"},
            startTime=EPOCH.isoformat(),
            endTime=(EPOCH + timedelta(hours=1)).isoformat(),
            samples=ORBIT_PARAMETERS_MAX_SAMPLES + 1,
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
