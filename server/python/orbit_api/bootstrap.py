"""FastAPI composition root: wires infrastructure, services and route adapters."""

from __future__ import annotations

import signal
from contextlib import asynccontextmanager

from fastapi import FastAPI

from orbit_api.api.routes.catalog import create_catalog_router
from orbit_api.api.routes.exports import create_exports_router
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.api.routes.orbit_parameters import create_orbit_parameters_router
from orbit_api.api.routes.orbits import create_orbits_router
from orbit_api.api.routes.precise_products import create_precise_products_router
from orbit_api.api.routes.realtime import create_realtime_router
from orbit_api.api.routes.system import create_system_router
from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.core.settings import COMPRESSION_THRESHOLD, CONFIG_DIR
from orbit_api.frames import build_frame_transformer_from_environment
from orbit_api.infrastructure.config_watcher import start_configuration_watcher
from orbit_api.timekeeping import ensure_utc


def create_app() -> FastAPI:
    """Build the Orbit ASGI application and inject its runtime dependencies."""
    # The shared frame factory loads pinned local time data once. No state
    # calculation or transformation is allowed to fetch it later.
    runtime = OrbitRuntime(frame_transformer=build_frame_transformer_from_environment())

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        runtime.load_constellation()
        observer = start_configuration_watcher(CONFIG_DIR, runtime.load_constellation)
        try:
            signal.signal(signal.SIGHUP, lambda *_: runtime.load_constellation())
        except (AttributeError, OSError, ValueError):
            pass
        try:
            yield
        finally:
            observer.stop()
            observer.join(timeout=2)

    app = FastAPI(title="Orbit Propagation API", version="0.1.0", description="Orbital propagation backend for Orbit.", docs_url="/docs", redoc_url="/redoc", openapi_url="/openapi.json", lifespan=lifespan)
    app.include_router(create_system_router(runtime.satellite_count, runtime.reload_constellation))
    app.include_router(create_catalog_router(runtime.catalog_satellite_ids))
    app.include_router(create_precise_products_router(
        runtime.import_precise_product,
        runtime.precise_products_payload,
        runtime.precise_product_import_payload,
    ))
    app.include_router(create_orbits_router(
        runtime.resolve_propagator,
        runtime.serialize_state,
        runtime.compute_auto_orbit_samples,
        runtime.build_ephemeris,
        runtime.renderer_state_at,
    ))
    app.include_router(create_manual_orbits_router(
        runtime.build_ephemeris,
        ensure_utc,
        runtime.frame_transformer,
    ))
    app.include_router(create_orbit_parameters_router(
        runtime.resolve_propagator,
        ensure_utc,
        runtime.frame_transformer,
    ))
    app.include_router(create_ground_stations_router(
        runtime.resolve_propagator,
        runtime.build_ephemeris,
        ensure_utc,
        runtime.frame_transformer,
    ))
    app.include_router(create_exports_router(
        runtime.find_catalog_entry,
        runtime.resolve_propagator,
        runtime.build_ephemeris,
        ensure_utc,
        runtime.frame_transformer,
    ))
    app.include_router(create_realtime_router(
        runtime.get_state_snapshot,
        runtime.get_orbits_cached,
        COMPRESSION_THRESHOLD,
        runtime.build_realtime_state,
    ))
    return app
