"""FastAPI composition root: wires infrastructure, services and route adapters."""

from __future__ import annotations

import os
import signal
from contextlib import asynccontextmanager
from pathlib import Path

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
from orbit_api.application.diagnostics import (
    GitHubActionsDiagnostics,
    PinnedEopDiagnostics,
    SystemDiagnostics,
    SystemHealthMonitor,
)
from orbit_api.application.manual_erp import ManualErpRepository
from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.core.settings import (
    COMPRESSION_THRESHOLD,
    CONFIG_DIR,
    IERS_EOP_C01_CACHE_PATH,
    IERS_FINALS2000A_CACHE_PATH,
    MANUAL_ERP_SNAPSHOTS_DIR,
)
from orbit_api.frames import build_frame_transformer_from_environment
from orbit_api.infrastructure.config_watcher import start_configuration_watcher
from orbit_api.orbits.forces import (
    build_gravity_field_from_environment,
    build_gravity_model_registry_from_environment,
)
from orbit_api.timekeeping import IersAutomaticEarthOrientationService, ensure_utc


def _enabled(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _monitor_interval_seconds(environment: dict[str, str]) -> float:
    value = str(environment.get("ORBIT_DIAGNOSTICS_MONITOR_INTERVAL_SECONDS", "")).strip()
    return 6 * 60 * 60 if not value else float(value)


def create_app() -> FastAPI:
    """Build the Orbit ASGI application and inject its runtime dependencies."""
    # The shared frame factory loads pinned local time data once. No state
    # calculation or transformation is allowed to fetch it later.
    environment = os.environ
    frame_transformer = build_frame_transformer_from_environment(environment)
    configured_c04_path = str(environment.get("ORBIT_EOP_C04_PATH", "")).strip()
    automatic_eop: IersAutomaticEarthOrientationService | None = None
    pinned_eop_diagnostics: PinnedEopDiagnostics | None = None
    if configured_c04_path:
        # A mounted, checksum-controlled C04 is an explicit reproducible
        # deployment contract. Never refresh it or replace it with C01 data.
        pinned_eop_diagnostics = PinnedEopDiagnostics(
            frame_transformer.earth_orientation_provider,
            configured_c04_path,
            source=str(environment.get("ORBIT_EOP_SOURCE", "IERS EOP C04")),
        )
    else:
        # The automatic route prefers C01 and then continues with the official
        # IERS finals2000A product. It is installed before the runtime is
        # built, but initially returns an explicitly labelled nominal provider
        # until the non-blocking monitor validates/downloads both snapshots.
        # SP3/manual ERP routes clone and override this service with their
        # product-bound provider, so no product provenance changes.
        c01_cache_path = Path(
            str(environment.get("ORBIT_EOP_C01_CACHE_PATH", "")).strip()
            or IERS_EOP_C01_CACHE_PATH
        ).expanduser()
        finals_cache_path = Path(
            str(environment.get("ORBIT_FINALS2000A_CACHE_PATH", "")).strip()
            or IERS_FINALS2000A_CACHE_PATH
        ).expanduser()
        automatic_eop = IersAutomaticEarthOrientationService(
            c01_cache_path,
            finals_cache_path,
            leap_seconds=frame_transformer.leap_second_table,
        )
        frame_transformer = frame_transformer.with_earth_orientation_provider(automatic_eop)
    # A configured ICGEM model is immutable and digest-verified before the
    # server starts.  Leaving it unset is valid; the manual API then keeps the
    # legacy zonal terms but rejects the configurable geopotential term.
    gravity_field = build_gravity_field_from_environment()
    # The NGA archive registry starts empty by design. Its monitor owns every
    # local validation/download after FastAPI becomes healthy; app construction
    # and all propagation paths remain free of that potentially large I/O.
    gravity_models = build_gravity_model_registry_from_environment(environment)
    # Manual TIME-tab ERP uploads are content-addressed local snapshots. The
    # mounted config volume keeps their immutable bytes available to project
    # restores without serialising them into project JSON.
    manual_erp_repository = ManualErpRepository(MANUAL_ERP_SNAPSHOTS_DIR)
    runtime = OrbitRuntime(frame_transformer=frame_transformer)
    diagnostics = SystemDiagnostics(
        frame_transformer=frame_transformer,
        eop_cache=automatic_eop,
        eop_payload=pinned_eop_diagnostics.payload if pinned_eop_diagnostics is not None else None,
        gravity_field=gravity_field,
        gravity_models=gravity_models,
        precise_products_payload=runtime.precise_products_payload,
        github_actions=GitHubActionsDiagnostics(
            repository=str(environment.get("ORBIT_GITHUB_REPOSITORY", "gabgarar/Orbit")),
            enabled=_enabled(environment.get("ORBIT_GITHUB_ACTIONS_MONITOR")),
        ),
    )
    monitor = SystemHealthMonitor(
        diagnostics,
        eop_cache=automatic_eop,
        gravity_models=gravity_models,
        interval_seconds=_monitor_interval_seconds(environment),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # This schedules disk/network EOP work immediately but never awaits it;
        # /health remains available while IERS is slow or unreachable.
        monitor.start()
        observer = None
        try:
            runtime.load_constellation()
            observer = start_configuration_watcher(CONFIG_DIR, runtime.load_constellation)
            try:
                signal.signal(signal.SIGHUP, lambda *_: runtime.load_constellation())
            except (AttributeError, OSError, ValueError):
                pass
            yield
        finally:
            if observer is not None:
                observer.stop()
                observer.join(timeout=2)
            monitor.stop()

    app = FastAPI(title="Orbit Propagation API", version="0.1.0", description="Orbital propagation backend for Orbit.", docs_url="/docs", redoc_url="/redoc", openapi_url="/openapi.json", lifespan=lifespan)
    app.state.system_diagnostics = diagnostics
    app.state.system_health_monitor = monitor
    app.state.automatic_eop_cache = automatic_eop
    app.state.gravity_model_registry = gravity_models
    app.include_router(
        create_system_router(
            runtime.satellite_count,
            runtime.reload_constellation,
            diagnostics.payload,
        )
    )
    app.include_router(create_catalog_router(runtime.catalog_satellite_ids))
    app.include_router(create_precise_products_router(
        runtime.import_precise_product,
        runtime.precise_products_payload,
        runtime.precise_product_import_payload,
        runtime.preview_precise_product,
    ))
    app.include_router(create_orbits_router(
        runtime.resolve_propagator,
        runtime.serialize_state,
        runtime.compute_auto_orbit_samples,
        runtime.build_ephemeris,
        runtime.renderer_state_at,
        runtime.native_state_at,
    ))
    app.include_router(create_manual_orbits_router(
        runtime.build_ephemeris,
        ensure_utc,
        runtime.frame_transformer,
        gravity_field,
        manual_erp_repository,
        gravity_models,
        diagnostics.startup_readiness_payload,
    ))
    app.include_router(create_orbit_parameters_router(
        runtime.resolve_propagator,
        ensure_utc,
        runtime.frame_transformer,
        gravity_field,
        manual_erp_repository,
        gravity_models,
        diagnostics.startup_readiness_payload,
    ))
    app.include_router(create_ground_stations_router(
        runtime.resolve_propagator,
        runtime.build_ephemeris,
        ensure_utc,
        runtime.frame_transformer,
        gravity_field,
        manual_erp_repository,
        gravity_models,
    ))
    app.include_router(create_exports_router(
        runtime.find_catalog_entry,
        runtime.resolve_propagator,
        runtime.build_ephemeris,
        ensure_utc,
        runtime.frame_transformer,
        gravity_field,
        manual_erp_repository,
        gravity_models,
    ))
    app.include_router(create_realtime_router(
        runtime.get_state_snapshot,
        runtime.get_orbits_cached,
        COMPRESSION_THRESHOLD,
        runtime.build_realtime_state,
    ))
    return app
