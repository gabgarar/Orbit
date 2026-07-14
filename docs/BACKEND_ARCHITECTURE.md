# Python backend architecture

`server/python/server.py` is the FastAPI composition root. It owns route
registration, application lifecycle, and dependency wiring only while the
legacy handlers are migrated incrementally. HTTP paths are grouped under
`orbit_api/api/routes`; the system and catalog routers are already mounted
there. Orbit propagation, ground-station, export, and realtime endpoints are
the next routers to migrate.

- `orbit_api/core`: runtime paths and operational limits.
- `orbit_api/domain`: validated input contracts independent from FastAPI route
  functions.
- `orbit_api/catalog`: filesystem repository and catalog normalization.
- `orbit_api/orbits`: propagation sampling policies and ephemeris behaviour.
  Implementations live below `orbits/propagators/<engine>` and conform to the
  shared `OrbitPropagator` protocol. The current engine is `sgp4`; adding a
  future propagator does not require changing consumers.
- `orbit_api/ground_stations`: horizon geometry and AOS/LOS access windows.
- `orbit_api/communications`: WebSocket transport, protocol types, decoder,
  encoder, and per-client subscription state.
- `orbit_api/application`: cross-domain use-case helpers and export
  serialization strategies.
- `orbit_api/infrastructure`: technical adapters such as the thread-safe TTL
  cache.

The migration rule is: extract cohesive behaviour into one of these modules,
then import it from `server.py`; endpoint URLs and payload formats remain
unchanged. This allows changes to be tested and deployed in small, reversible
steps.

For a new propagator, add `orbits/propagators/<engine>/`, implement the
`OrbitPropagator` protocol, and register its factory in
`orbits/propagators/registry.py`. API routes and services must depend on the
protocol, never on a concrete engine such as SGP4.
