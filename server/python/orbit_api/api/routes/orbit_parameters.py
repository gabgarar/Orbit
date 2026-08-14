"""HTTP adapter for propagated osculating orbital-parameter inspection."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from orbit_api.api.routes.startup_gate import (
    StartupReadinessProvider,
    require_project_startup_ready,
)
from orbit_api.application.manual_orbits import ManualOrbitError
from orbit_api.application.manual_erp import ManualErpRepository
from orbit_api.application.orbit_parameters import (
    OrbitParametersError,
    build_orbit_parameters,
)
from orbit_api.domain.requests import OrbitParametersRequest
from orbit_api.frames import FrameTransformService
from orbit_api.orbits.forces import GravityFieldModel, GravityModelRegistry


def create_orbit_parameters_router(
    resolve_propagator: Callable,
    ensure_utc: Callable,
    frame_transformer: FrameTransformService | None = None,
    gravity_field: GravityFieldModel | None = None,
    manual_erp_repository: ManualErpRepository | None = None,
    gravity_models: GravityModelRegistry | None = None,
    startup_readiness: StartupReadinessProvider | None = None,
) -> APIRouter:
    """Build the bounded inspector endpoint without leaking renderer frames."""

    router = APIRouter(tags=["orbit-parameters"])

    @router.post("/orbit-parameters")
    def inspect_orbit_parameters(payload: OrbitParametersRequest) -> dict:
        require_project_startup_ready(startup_readiness)
        try:
            return build_orbit_parameters(
                payload,
                resolve_propagator=resolve_propagator,
                ensure_utc=ensure_utc,
                frame_transformer=frame_transformer,
                gravity_field=gravity_field,
                manual_erp_repository=manual_erp_repository,
                gravity_model_registry=gravity_models,
            )
        except HTTPException:
            # Resolver errors retain their specific contract: unknown loaded
            # satellite is 404, malformed explicit TLE is 400.
            raise
        except (OrbitParametersError, ManualOrbitError, ValueError) as exc:
            # Invalid state/range/manual drag decay is actionable input, not a
            # server failure.  Pydantic validation already uses FastAPI 422
            # for malformed payload shapes before this handler runs.
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return router
