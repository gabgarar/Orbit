# Python backend architecture

`server/python/server.py` is only the ASGI entry point used by Uvicorn. It
creates the application from `orbit_api.bootstrap` and contains no domain,
state, cache, route, or lifecycle logic. `orbit_api.bootstrap` is the FastAPI
composition root: it wires routes, the application lifespan, configuration
watching, and concrete services together.

- `orbit_api/core`: runtime paths, operational limits, and system
  configuration normalisation/loading.
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
- `orbit_api/application`: use-case services. `OrbitRuntime` owns the loaded
  constellation, cache coordination, propagator selection, orbit generation,
  and ephemeris generation; `exporters` owns output formats.
- `orbit_api/infrastructure`: technical adapters such as the thread-safe TTL
  cache and filesystem configuration watcher.

The layering rule is: routes adapt HTTP/WebSocket input to application
services; application services orchestrate domains; infrastructure remains at
the edge. Endpoint URLs and payload formats remain unchanged.

For a new propagator, add `orbits/propagators/<engine>/`, implement the
`OrbitPropagator` protocol, and register its factory in
`orbits/propagators/registry.py`. API routes and services must depend on the
protocol, never on a concrete engine such as SGP4.
