"""Route factories expose the complete public HTTP and WebSocket contract."""

import pytest
from fastapi import HTTPException
from orbit_api.api.routes.catalog import create_catalog_router
from orbit_api.api.routes.exports import create_exports_router
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.api.routes.orbit_parameters import create_orbit_parameters_router
from orbit_api.api.routes.orbits import create_orbits_router
from orbit_api.api.routes.precise_products import create_precise_products_router
from orbit_api.api.routes.realtime import create_realtime_router
from orbit_api.api.routes.system import create_system_router


def _paths(router): return {route.path for route in router.routes}


def test_every_domain_route_factory_has_its_public_paths():
    resolver = lambda *_: ("ISS", object())
    ephemeris = lambda *_: {"satellite": "ISS", "points": []}
    assert _paths(create_system_router(lambda: 1, lambda: 1)) == {
        "/health", "/reload", "/system/diagnostics", "/diagnostics",
    }
    assert _paths(create_catalog_router(lambda: ["ISS"])) == {"/catalog"}
    assert _paths(create_precise_products_router(lambda *_args, **_kwargs: object(), lambda: {})) == {
        "/precise-products", "/precise-products/import", "/precise-products/preview",
    }
    assert {"/propagate", "/orbits", "/ephemeris"} <= _paths(create_orbits_router(resolver, lambda *_args, **_kwargs: {}, lambda *_: 2, ephemeris))
    assert _paths(create_manual_orbits_router(ephemeris, lambda value: value)) == {
        "/manual-orbits", "/manual-orbits/capabilities", "/manual-orbits/time/erp-preview",
    }
    assert _paths(create_orbit_parameters_router(resolver, lambda value: value)) == {"/orbit-parameters"}
    ground_station_paths = _paths(create_ground_stations_router(resolver, ephemeris, lambda x: x))
    assert {"/aos-los", "/ground-stations/export"} <= ground_station_paths
    export_paths = _paths(create_exports_router(lambda _: None, resolver, ephemeris, lambda x: x))
    assert {"/export/tle/{sat_id}", "/export/manual-ephemeris"} <= export_paths
    assert _paths(create_realtime_router(lambda: ([], {}, {}), lambda *_: [], 100)) == {"/ws"}


def test_system_diagnostics_route_uses_the_injected_snapshot_without_global_state():
    expected = {"status": "warning", "generatedAt": "2026-07-26T00:00:00+00:00", "components": {}}
    router = create_system_router(lambda: 1, lambda: 1, lambda: expected)
    endpoint = next(route.endpoint for route in router.routes if route.path == "/system/diagnostics")
    alias = next(route.endpoint for route in router.routes if route.path == "/diagnostics")

    assert endpoint() == expected
    assert alias() == expected


def test_health_remains_a_liveness_endpoint_while_readiness_is_reported_elsewhere():
    router = create_system_router(lambda: 7, lambda: 7)
    endpoint = next(route.endpoint for route in router.routes if route.path == "/health")

    assert endpoint() == {"status": "ok", "satellites": 7}


def test_orbit_routes_turn_precise_coverage_or_frame_failures_into_422():
    router = create_orbits_router(
        lambda *_: ("precise:product:G01", object()),
        lambda *_args, **_kwargs: {},
        lambda *_: 2,
        lambda *_: {},
        lambda *_: (_ for _ in ()).throw(ValueError("fuera de cobertura SP3")),
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/propagate/{sat_id}")

    with pytest.raises(HTTPException) as raised:
        endpoint("precise:product:G01", at=None)

    assert raised.value.status_code == 422
    assert "fuera de cobertura SP3" in str(raised.value.detail)
