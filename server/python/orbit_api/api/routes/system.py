"""System health and runtime reload endpoints."""

from collections.abc import Callable

from fastapi import APIRouter


def create_system_router(
    satellite_count: Callable[[], int],
    reload_constellation: Callable[[], int],
) -> APIRouter:
    """Build endpoints for operational status without importing global state."""
    router = APIRouter(tags=["system"])

    @router.get("/health")
    def health() -> dict:
        return {"status": "ok", "satellites": satellite_count()}

    @router.post("/reload")
    def reload_endpoint() -> dict:
        return {"status": "reloaded", "satellites": reload_constellation()}

    return router
