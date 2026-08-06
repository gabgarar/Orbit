"""Route factories expose the complete public HTTP and WebSocket contract."""

from orbit_api.api.routes.catalog import create_catalog_router
from orbit_api.api.routes.exports import create_exports_router
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.api.routes.orbit_parameters import create_orbit_parameters_router
from orbit_api.api.routes.orbits import create_orbits_router
from orbit_api.api.routes.realtime import create_realtime_router
from orbit_api.api.routes.system import create_system_router


def _paths(router): return {route.path for route in router.routes}


def test_every_domain_route_factory_has_its_public_paths():
    resolver = lambda *_: ("ISS", object())
    ephemeris = lambda *_: {"satellite": "ISS", "points": []}
    assert _paths(create_system_router(lambda: 1, lambda: 1)) == {"/health", "/reload"}
    assert _paths(create_catalog_router(lambda: ["ISS"])) == {"/catalog"}
    assert {"/propagate", "/orbits", "/ephemeris"} <= _paths(create_orbits_router(resolver, lambda *_args, **_kwargs: {}, lambda *_: 2, ephemeris))
    assert _paths(create_manual_orbits_router(ephemeris, lambda value: value)) == {"/manual-orbits"}
    assert _paths(create_orbit_parameters_router(resolver, lambda value: value)) == {"/orbit-parameters"}
    assert "/aos-los" in _paths(create_ground_stations_router(resolver, ephemeris, lambda x: x))
    assert "/export/tle/{sat_id}" in _paths(create_exports_router(lambda _: None, resolver, ephemeris, lambda x: x))
    assert _paths(create_realtime_router(lambda: ([], {}, {}), lambda *_: [], 100)) == {"/ws"}
