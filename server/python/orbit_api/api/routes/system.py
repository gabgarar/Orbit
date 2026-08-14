"""System health and runtime reload endpoints."""

from collections.abc import Callable

from fastapi import APIRouter


def create_system_router(
    satellite_count: Callable[[], int],
    reload_constellation: Callable[[], int],
    diagnostics_payload: Callable[[], dict[str, object]] | None = None,
) -> APIRouter:
    """Build endpoints for operational status without importing global state."""
    router = APIRouter(tags=["system"])

    @router.get("/health")
    def health() -> dict:
        return {"status": "ok", "satellites": satellite_count()}

    @router.post("/reload")
    def reload_endpoint() -> dict:
        return {"status": "reloaded", "satellites": reload_constellation()}

    def diagnostic_snapshot() -> dict[str, object]:
        if diagnostics_payload is not None:
            return diagnostics_payload()
        # Route factories remain independently testable.  Composition always
        # injects the real service, while this explicit fallback prevents a
        # synthetic healthy result if an embedder omitted it.
        return {
            "status": "unknown",
            "generatedAt": None,
            "components": {
                "erp": {
                    "status": "unknown",
                    "lastValidation": None,
                    "details": {},
                    "error": "El servicio de diagnósticos no está configurado.",
                }
            },
        }

    @router.get("/system/diagnostics")
    def diagnostics() -> dict[str, object]:
        """Return bounded backend health/provenance for the Built-In Test panel."""

        return diagnostic_snapshot()

    # Compatibility alias for integrations built before the system namespace
    # was reserved.  The Node gateway exposes both /api paths intentionally.
    @router.get("/diagnostics")
    def diagnostics_alias() -> dict[str, object]:
        return diagnostic_snapshot()

    return router
