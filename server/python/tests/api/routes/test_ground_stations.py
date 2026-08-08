"""Operational geometry tests for the AOS/LOS route contract."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.domain.requests import AosLosRequest, StationInput
from orbit_api.frames import FrameTransformService
from pydantic import ValidationError

WGS84_EQUATORIAL_RADIUS_M = 6_378_137.0
START = datetime(2026, 1, 1, tzinfo=UTC)


def _itrf_point(*, elevation_deg: float, azimuth_deg: float, time: datetime = START) -> dict:
    """Return an ITRF point in a known ENU direction from 0N, 0E.

    The station's WGS-84 position is ``(a, 0, 0)``.  At this location the
    ITRF axes map directly to local up (x), east (y), and north (z), making
    the test direction independent of any external propagator.
    """
    import math

    horizontal_m = 1_000_000.0
    elevation = math.radians(elevation_deg)
    azimuth = math.radians(azimuth_deg)
    up_m = horizontal_m * math.tan(elevation)
    north_m = horizontal_m * math.cos(azimuth)
    east_m = horizontal_m * math.sin(azimuth)
    return {
        "time": time.isoformat(),
        "position": {
            "x": WGS84_EQUATORIAL_RADIUS_M + up_m,
            "y": east_m,
            "z": north_m,
        },
    }


def _zenith_point(*, time: datetime = START) -> dict:
    """Return an exact local-zenith ITRF point at 0N, 0E."""

    return {
        "time": time.isoformat(),
        "position": {
            "x": WGS84_EQUATORIAL_RADIUS_M + 1_000_000.0,
            "y": 0.0,
            "z": 0.0,
        },
    }


def _post_endpoint_for(points: list[dict]):
    def resolve_propagator(*_args):
        return "TEST", object()

    def build_ephemeris(*_args):
        return {
            "points": points,
            "reference_frame": "ITRF",
            "transport_time_scale": "UTC",
        }

    router = create_ground_stations_router(resolve_propagator, build_ephemeris, lambda value: value)
    return next(route.endpoint for route in router.routes if route.path == "/aos-los" and "POST" in route.methods)


def _get_endpoint_for(points: list[dict]):
    def resolve_propagator(*_args):
        return "TEST", object()

    def build_ephemeris(*_args):
        return {
            "points": points,
            "reference_frame": "ITRF",
            "transport_time_scale": "UTC",
        }

    router = create_ground_stations_router(resolve_propagator, build_ephemeris, lambda value: value)
    return next(route.endpoint for route in router.routes if route.path == "/aos-los" and "GET" in route.methods)


def _request(station: StationInput) -> AosLosRequest:
    return AosLosRequest(
        sat_id="TEST",
        station=station,
        start_time=START,
        end_time=START + timedelta(minutes=1),
        step_seconds=30,
    )


def _sample_for(point: dict, station: StationInput) -> dict:
    response = _post_endpoint_for([point])(_request(station))
    assert response["reference_frame"] == "ITRF"
    assert response["time_scale"] == "UTC"
    return response


def test_aos_los_uses_the_station_elevation_mask_for_samples_and_passes():
    response = _sample_for(
        _itrf_point(elevation_deg=25, azimuth_deg=0),
        StationInput(lat_deg=0, lon_deg=0, min_elevation_deg=30),
    )

    assert response["samples"][0]["elevation_deg"] == pytest.approx(25)
    assert response["samples"][0]["geometric_visible"] is False
    assert response["samples"][0]["visible"] is False
    assert response["passes"] == []


def test_aos_los_uses_position_only_ephemerides_and_can_omit_samples():
    """Event-only consumers retain pass extraction without the large chart body."""

    calls = []
    points = [_itrf_point(elevation_deg=45, azimuth_deg=0)]

    def resolve_propagator(*_args):
        return "TEST", object()

    def build_ephemeris(*args):
        calls.append(args)
        return {
            "points": points,
            "reference_frame": "ITRF",
            "transport_time_scale": "UTC",
        }

    router = create_ground_stations_router(resolve_propagator, build_ephemeris, lambda value: value)
    endpoint = next(route.endpoint for route in router.routes if route.path == "/aos-los" and "POST" in route.methods)
    response = endpoint(_request(StationInput(lat_deg=0, lon_deg=0, min_elevation_deg=10)).model_copy(
        update={"include_samples": False}
    ))

    assert calls[0][-2:] == (False, True)
    assert response["count"] == 1
    assert response["samples"] == []
    assert len(response["passes"]) == 1


def test_get_aos_los_can_omit_samples_without_changing_the_count():
    endpoint = _get_endpoint_for([_itrf_point(elevation_deg=45, azimuth_deg=0)])

    response = endpoint(
        sat_id="TEST",
        station_lat_deg=0,
        station_lon_deg=0,
        station_height_m=0,
        min_elevation_deg=10,
        max_range_km=None,
        mechanical_elevation_min_deg=0,
        mechanical_elevation_max_deg=90,
        mechanical_azimuth_min_deg=-180,
        mechanical_azimuth_max_deg=180,
        operation_mode="tracking",
        boresight_azimuth_deg=0,
        boresight_elevation_deg=90,
        beam_half_angle_deg=None,
        pattern_type="gaussian",
        hpbw_azimuth_deg=None,
        hpbw_elevation_deg=None,
        side_lobe_level_db=25,
        start_time=START,
        end_time=START + timedelta(minutes=1),
        step_seconds=30,
        include_samples=False,
    )

    assert response["count"] == 1
    assert response["samples"] == []
    assert len(response["passes"]) == 1


def test_post_aos_los_can_return_only_chart_samples_near_refined_passes():
    """A detailed chart need not receive every vertex from its 24-hour scan."""
    station = StationInput(lat_deg=0, lon_deg=0, min_elevation_deg=10)
    points = [
        _itrf_point(elevation_deg=0, azimuth_deg=0, time=START),
        _itrf_point(elevation_deg=45, azimuth_deg=0, time=START + timedelta(seconds=30)),
        _itrf_point(elevation_deg=40, azimuth_deg=0, time=START + timedelta(seconds=60)),
        _itrf_point(elevation_deg=0, azimuth_deg=0, time=START + timedelta(seconds=90)),
        _itrf_point(elevation_deg=0, azimuth_deg=0, time=START + timedelta(seconds=120)),
    ]
    request = AosLosRequest(
        sat_id="TEST",
        station=station,
        start_time=START,
        end_time=START + timedelta(minutes=2),
        step_seconds=30,
        include_samples=True,
        chart_padding_seconds=0,
    )

    response = _post_endpoint_for(points)(request)

    assert response["count"] == 5
    assert response["returned_sample_count"] == 2
    assert response["sample_scope"] == "pass-windows"
    assert response["chart_padding_seconds"] == 0
    assert [sample["time"] for sample in response["samples"]] == [
        (START + timedelta(seconds=30)).isoformat(),
        (START + timedelta(seconds=60)).isoformat(),
    ]
    assert len(response["passes"]) == 1


def test_get_aos_los_accepts_chart_padding_and_reports_the_compact_scope():
    endpoint = _get_endpoint_for([
        _itrf_point(elevation_deg=45, azimuth_deg=0, time=START),
    ])

    response = endpoint(
        sat_id="TEST",
        station_lat_deg=0,
        station_lon_deg=0,
        station_height_m=0,
        min_elevation_deg=10,
        max_range_km=None,
        mechanical_elevation_min_deg=0,
        mechanical_elevation_max_deg=90,
        mechanical_azimuth_min_deg=-180,
        mechanical_azimuth_max_deg=180,
        operation_mode="tracking",
        boresight_azimuth_deg=0,
        boresight_elevation_deg=90,
        beam_half_angle_deg=None,
        pattern_type="gaussian",
        hpbw_azimuth_deg=None,
        hpbw_elevation_deg=None,
        side_lobe_level_db=25,
        start_time=START,
        end_time=START + timedelta(minutes=1),
        step_seconds=30,
        include_samples=True,
        chart_padding_seconds=120,
    )

    assert response["count"] == 1
    assert response["returned_sample_count"] == 1
    assert response["sample_scope"] == "pass-windows"
    assert response["chart_padding_seconds"] == 120


@pytest.mark.parametrize(
    ("point", "station"),
    [
        (
            _itrf_point(elevation_deg=55, azimuth_deg=0),
            StationInput(
                lat_deg=0,
                lon_deg=0,
                min_elevation_deg=0,
                mechanical_elevation_min_deg=0,
                mechanical_elevation_max_deg=45,
            ),
        ),
        (
            _itrf_point(elevation_deg=45, azimuth_deg=90),
            StationInput(
                lat_deg=0,
                lon_deg=0,
                min_elevation_deg=0,
                mechanical_azimuth_min_deg=-20,
                mechanical_azimuth_max_deg=20,
            ),
        ),
    ],
    ids=("elevation-stop", "azimuth-stop"),
)
def test_aos_los_applies_mechanical_mount_limits(point, station):
    response = _sample_for(point, station)

    assert response["samples"][0]["geometric_visible"] is False
    assert response["samples"][0]["operational_visible"] is False
    assert response["passes"] == []


def test_aos_los_keeps_stationary_hpbw_as_a_diagnostic_not_a_binary_gate():
    response = _sample_for(
        _itrf_point(elevation_deg=45, azimuth_deg=35),
        StationInput(
            lat_deg=0,
            lon_deg=0,
            min_elevation_deg=0,
            operation_mode="stationary",
            boresight_azimuth_deg=0,
            boresight_elevation_deg=45,
            beam_half_angle_deg=10,
        ),
    )

    sample = response["samples"][0]
    assert sample["boresight_separation_deg"] > 10
    assert sample["within_main_lobe"] is False
    assert sample["pattern_loss_db"] < 0
    # HPBW is the -3 dB contour. With no range budget supplied, an off-axis
    # target remains operationally visible rather than being cut off by a
    # fictitious hard beam edge.
    assert sample["geometric_visible"] is True
    assert sample["operational_visible"] is True
    assert len(response["passes"]) == 1


def test_aos_los_applies_stationary_pattern_loss_to_the_rf_range_gate():
    """A point inside the HPBW can still fail after its off-axis loss.

    The test range is below the 1,500 km boresight envelope but above the
    Gaussian range after the 20 degree azimuth offset. This protects the
    agreement between the pass table and the station designer/green link.
    """
    response = _sample_for(
        _itrf_point(elevation_deg=45, azimuth_deg=20),
        StationInput(
            lat_deg=0,
            lon_deg=0,
            min_elevation_deg=0,
            max_range_km=1_500,
            operation_mode="stationary",
            boresight_azimuth_deg=0,
            boresight_elevation_deg=45,
            beam_half_angle_deg=30,
            pattern_type="gaussian",
            hpbw_azimuth_deg=60,
            hpbw_elevation_deg=60,
            side_lobe_level_db=25,
        ),
    )

    sample = response["samples"][0]
    assert sample["geometric_visible"] is True
    assert sample["pattern_loss_db"] < 0
    assert sample["directional_max_range_km"] < sample["range_km"]
    assert sample["rf_visible"] is False
    assert response["passes"] == []


def test_aos_los_keeps_the_rf_range_gate_separate_from_geometric_visibility():
    response = _sample_for(
        _itrf_point(elevation_deg=45, azimuth_deg=0),
        StationInput(lat_deg=0, lon_deg=0, min_elevation_deg=0, max_range_km=1_000),
    )

    sample = response["samples"][0]
    assert sample["geometric_visible"] is True
    assert sample["rf_visible"] is False
    assert sample["visible"] is False
    assert response["passes"] == []


def test_aos_los_publishes_a_pass_only_when_all_station_gates_are_satisfied():
    response = _sample_for(
        _itrf_point(elevation_deg=45, azimuth_deg=0),
        StationInput(
            lat_deg=0,
            lon_deg=0,
            min_elevation_deg=30,
            mechanical_elevation_min_deg=30,
            mechanical_elevation_max_deg=60,
            mechanical_azimuth_min_deg=-10,
            mechanical_azimuth_max_deg=10,
            operation_mode="stationary",
            boresight_azimuth_deg=0,
            boresight_elevation_deg=45,
            beam_half_angle_deg=10,
        ),
    )

    assert response["samples"][0]["visible"] is True
    assert len(response["passes"]) == 1


def test_aos_los_uses_enu_vectors_for_a_zenith_stationary_pattern():
    response = _sample_for(
        _zenith_point(),
        StationInput(
            lat_deg=0,
            lon_deg=0,
            min_elevation_deg=0,
            max_range_km=2_000,
            operation_mode="stationary",
            # The azimuth at zenith is only an antenna roll reference; it
            # cannot turn a zenith target into a 90-degree pattern error.
            boresight_azimuth_deg=137,
            boresight_elevation_deg=90,
            hpbw_azimuth_deg=8,
            hpbw_elevation_deg=8,
        ),
    )

    sample = response["samples"][0]
    assert sample["boresight_separation_deg"] == pytest.approx(0, abs=1e-9)
    assert sample["pattern_loss_db"] == pytest.approx(0, abs=1e-9)
    assert sample["within_main_lobe"] is True
    assert sample["operational_visible"] is True


def test_aos_los_does_not_apply_an_arbitrary_azimuth_stop_at_exact_zenith():
    response = _sample_for(
        _zenith_point(),
        StationInput(
            lat_deg=0,
            lon_deg=0,
            min_elevation_deg=0,
            mechanical_azimuth_min_deg=10,
            mechanical_azimuth_max_deg=20,
            operation_mode="tracking",
        ),
    )

    sample = response["samples"][0]
    assert sample["azimuth_deg"] == pytest.approx(0)
    assert sample["geometric_visible"] is True
    assert sample["operational_visible"] is True


def test_aos_los_exposes_scan_as_potential_coverage_without_publishing_a_pass():
    response = _sample_for(
        _itrf_point(elevation_deg=45, azimuth_deg=0),
        StationInput(
            lat_deg=0,
            lon_deg=0,
            min_elevation_deg=0,
            max_range_km=2_000,
            operation_mode="scan",
        ),
    )

    sample = response["samples"][0]
    assert sample["geometric_visible"] is True
    assert sample["rf_visible"] is True
    assert sample["potential_visible"] is True
    assert sample["operational_visible"] is False
    assert sample["visible"] is False
    assert sample["scan_schedule_required"] is True
    assert sample["directional_pattern_applied"] is False
    assert sample["pattern_loss_db"] is None
    assert sample["visibility_status"] == "scan-schedule-required"
    assert response["passes"] == []


def test_get_aos_los_returns_422_for_an_invalid_mount_contract():
    get_endpoint = _get_endpoint_for([])

    with pytest.raises(HTTPException) as error:
        get_endpoint(
            sat_id="TEST",
            station_lat_deg=0,
            station_lon_deg=0,
            station_height_m=0,
            min_elevation_deg=10,
            max_range_km=None,
            mechanical_elevation_min_deg=60,
            mechanical_elevation_max_deg=20,
            mechanical_azimuth_min_deg=-180,
            mechanical_azimuth_max_deg=180,
            operation_mode="tracking",
            boresight_azimuth_deg=0,
            boresight_elevation_deg=90,
            beam_half_angle_deg=None,
            pattern_type="gaussian",
            hpbw_azimuth_deg=None,
            hpbw_elevation_deg=None,
            side_lobe_level_db=25,
            start_time=START,
            end_time=START + timedelta(minutes=1),
            step_seconds=30,
        )

    assert error.value.status_code == 422
    assert error.value.detail[0]["loc"] == ["query"]


def _manual_access_request(*, propagator: str = "two-body") -> AosLosRequest:
    """Build the public manual-source shape sent by the design workspace."""

    return AosLosRequest.model_validate({
        "source": {
            "type": "manual",
            "manualOrbit": {
                "name": "Manual access target",
                "epochUtc": START.isoformat(),
                "propagator": propagator,
                "definitionSource": "keplerian",
                "keplerian": {
                    "semiMajorAxisKm": 7_000.0,
                    "eccentricity": 0.01,
                    "inclinationDeg": 45.0,
                    "raanDeg": 15.0,
                    "argumentOfPerigeeDeg": 30.0,
                    "trueAnomalyDeg": 20.0,
                },
            },
        },
        "station": {"lat_deg": 0.0, "lon_deg": 0.0, "min_elevation_deg": 10.0},
        "startTime": START.isoformat(),
        "endTime": (START + timedelta(minutes=1)).isoformat(),
        "stepSeconds": 30,
    })


def test_post_aos_los_uses_the_manual_two_body_engine_and_shared_itrf_transformer():
    """Manual AOS/LOS must use its native engine, then renderer ITRF points."""

    frame_transformer = FrameTransformService()
    calls = []

    def resolve_propagator(*_args):
        raise AssertionError("A manual AOS/LOS request must not resolve a catalogue TLE")

    def build_ephemeris(*args):
        calls.append(args)
        return {
            "points": [_itrf_point(elevation_deg=45, azimuth_deg=0)],
            "reference_frame": "ITRF",
            "transport_time_scale": "UTC",
        }

    router = create_ground_stations_router(
        resolve_propagator,
        build_ephemeris,
        lambda value: value,
        frame_transformer,
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/aos-los" and "POST" in route.methods)

    response = endpoint(_manual_access_request())

    assert len(calls) == 1
    runtime_name, propagator, *_rest = calls[0]
    assert runtime_name.startswith("manual:two-body:")
    assert propagator.frame_transformer is frame_transformer
    assert calls[0][-2:] == (False, True)
    assert response["satellite"] == "Manual access target"
    assert response["source"] == {
        "kind": "manual",
        "name": "Manual access target",
        "propagator": "two-body",
        "definition_source": "keplerian",
        "dynamics_reference_frame": "EME2000",
        "ephemeris_reference_frame": "ITRF",
    }
    assert response["reference_frame"] == "ITRF"
    assert response["time_scale"] == "UTC"
    assert len(response["passes"]) == 1


def test_post_aos_los_rejects_an_unavailable_manual_sgp4_engine():
    """A manual state cannot silently become a synthetic TEME/TLE source."""

    router = create_ground_stations_router(
        lambda *_args: ("CATALOGUE", object()),
        lambda *_args: {"points": []},
        lambda value: value,
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/aos-los" and "POST" in route.methods)

    with pytest.raises(HTTPException) as error:
        endpoint(_manual_access_request(propagator="sgp4"))

    assert error.value.status_code == 422
    assert "SGP4" in str(error.value.detail)


def test_aos_los_legacy_catalogue_fields_are_projected_to_the_explicit_source():
    """The new source node must not break the original POST request shape."""

    request = AosLosRequest(
        sat_id="CATALOGUE-1",
        station=StationInput(lat_deg=0, lon_deg=0),
        start_time=START,
        end_time=START + timedelta(minutes=1),
    )

    assert request.source is not None
    assert request.source.kind == "catalog"
    assert request.source.sat_id == "CATALOGUE-1"


def test_aos_los_manual_source_requires_a_complete_manual_orbit_definition():
    with pytest.raises(ValidationError) as error:
        AosLosRequest.model_validate({
            "source": {"type": "manual"},
            "station": {"lat_deg": 0, "lon_deg": 0},
            "startTime": START.isoformat(),
            "endTime": (START + timedelta(minutes=1)).isoformat(),
        })

    assert "manual_orbit" in str(error.value)
