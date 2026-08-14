"""Fail-closed project-operation gate backed by startup diagnostics."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from fastapi import HTTPException


StartupReadinessProvider = Callable[[], Mapping[str, object]]


def require_project_startup_ready(provider: StartupReadinessProvider | None) -> None:
    """Reject project-generating work until mandatory startup data is ready.

    The callback is optional so standalone router-factory tests and external
    embedders retain their previous explicit behaviour.  The composed Orbit
    application always supplies it.  This is intentionally a 503 rather than
    a validation 422: retrying after the monitor finishes is the correct
    client action, and ``/health`` remains a liveness endpoint throughout.
    """

    if provider is None:
        return
    try:
        readiness = provider()
        if not isinstance(readiness, Mapping):
            raise TypeError("startup readiness must be a mapping")
    except Exception as exc:  # fail closed if diagnostics wiring itself breaks
        raise HTTPException(
            status_code=503,
            detail={
                "code": "STARTUP_READINESS_UNAVAILABLE",
                "message": "No se puede comprobar si Orbit ha terminado de inicializarse.",
                "readiness": {"state": "blocked", "projectReady": False},
            },
            headers={"Retry-After": "3"},
        ) from exc
    project_ready = readiness.get("projectReady", readiness.get("ready")) is True
    if project_ready:
        return
    state = str(readiness.get("state") or "pending").strip().lower()
    if state not in {"pending", "blocked", "ready", "degraded-ready"}:
        state = "pending"
    message = str(readiness.get("message") or "Orbit todavía está preparando sus recursos de inicio.")
    public_readiness = {
        "state": state,
        "ready": False,
        "projectReady": False,
        "completed": readiness.get("completed") is True,
        "pending": list(readiness.get("pending", [])) if isinstance(readiness.get("pending"), list) else [],
        "blockers": list(readiness.get("blockers", [])) if isinstance(readiness.get("blockers"), list) else [],
        "message": message[:500],
    }
    raise HTTPException(
        status_code=503,
        detail={
            "code": "STARTUP_NOT_READY",
            "message": public_readiness["message"],
            "readiness": public_readiness,
        },
        headers={"Retry-After": "3"},
    )


__all__ = ["StartupReadinessProvider", "require_project_startup_ready"]
