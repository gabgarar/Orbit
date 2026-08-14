"""Fail-closed API contracts for project work during startup."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from orbit_api.api.routes.manual_orbits import create_manual_orbits_router
from orbit_api.api.routes.orbit_parameters import create_orbit_parameters_router


def _endpoint(router, path: str):
    return next(route.endpoint for route in router.routes if route.path == path)


def _pending_readiness():
    return {
        "state": "pending",
        "projectReady": False,
        "completed": False,
        "pending": [{"id": "gravity-validation", "status": "pending"}],
        "blockers": [],
        "message": "Orbit is validating NGA gravity data.",
    }


@pytest.mark.parametrize(
    ("router", "path"),
    (
        (
            lambda: create_manual_orbits_router(
                lambda *_args: {},
                lambda value: value,
                startup_readiness=_pending_readiness,
            ),
            "/manual-orbits",
        ),
        (
            lambda: create_orbit_parameters_router(
                lambda *_args: ("ISS", object()),
                lambda value: value,
                startup_readiness=_pending_readiness,
            ),
            "/orbit-parameters",
        ),
    ),
)
def test_project_endpoints_return_retryable_503_before_startup_readiness(router, path):
    endpoint = _endpoint(router(), path)

    with pytest.raises(HTTPException) as raised:
        # Direct invocation is enough: the gate runs before it reads the
        # Pydantic payload, which mirrors a valid HTTP request at this point.
        endpoint(None)

    assert raised.value.status_code == 503
    assert raised.value.headers == {"Retry-After": "3"}
    assert raised.value.detail["code"] == "STARTUP_NOT_READY"
    assert raised.value.detail["readiness"]["state"] == "pending"


def test_degraded_erp_readiness_keeps_project_routes_available():
    router = create_manual_orbits_router(
        lambda *_args: {},
        lambda value: value,
        startup_readiness=lambda: {"state": "degraded-ready", "projectReady": True},
    )
    endpoint = _endpoint(router, "/manual-orbits")

    # No 503 means the gate honoured the explicit nominal-ERP fallback. The
    # deliberately incomplete payload fails later in normal request handling.
    with pytest.raises(Exception) as raised:
        endpoint(None)
    assert not (isinstance(raised.value, HTTPException) and raised.value.status_code == 503)
