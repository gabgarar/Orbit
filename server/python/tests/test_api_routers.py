from orbit_api.api.routes.catalog import create_catalog_router
from orbit_api.api.routes.exports import create_exports_router
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.api.routes.orbits import create_orbits_router
from orbit_api.api.routes.realtime import create_realtime_router
from orbit_api.api.routes.system import create_system_router


def route_paths(router):
    return {route.path for route in router.routes}


def test_every_api_domain_exposes_its_expected_transport_paths():
    resolver = lambda *_: ("ISS", object())
    serializer = lambda *_args, **_kwargs: {}
    samples = lambda *_args: 2
    ephemeris = lambda *_args: {"satellite": "ISS", "points": []}
    utc = lambda value: value

    assert route_paths(create_system_router(lambda: 1, lambda: 1)) == {"/health", "/reload"}
    assert route_paths(create_catalog_router(lambda: ["ISS"])) == {"/catalog"}
    assert {"/propagate/{sat_id}", "/propagate", "/orbits/{sat_id}", "/orbits", "/ephemeris"} <= route_paths(create_orbits_router(resolver, serializer, samples, ephemeris))
    assert {"/aos-los"} <= route_paths(create_ground_stations_router(resolver, ephemeris, utc))
    assert {"/export/tle/{sat_id}", "/export/omm/{sat_id}", "/export/ocm/{sat_id}", "/export/ephemeris/{sat_id}"} <= route_paths(create_exports_router(lambda _: None, resolver, ephemeris, utc))
    assert route_paths(create_realtime_router(lambda: ([], {}, {}), lambda *_: [], 1024)) == {"/ws"}
