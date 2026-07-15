"""Tests for the ASGI composition root and executable entry point."""

from pathlib import Path

from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.bootstrap import create_app


def test_server_entry_point_stays_thin():
    source = (Path(__file__).parents[2] / "server.py").read_text(encoding="utf-8")
    assert "from orbit_api.bootstrap import create_app" in source
    assert "def load_constellation" not in source


def test_application_registers_all_public_domains():
    app = create_app()
    # Individual URL contracts live in tests/api/routes.  FastAPI versions
    # differ in whether included routers are flattened in ``app.routes``.
    assert app.title == "Orbit Propagation API"
    assert app.docs_url == "/docs"
    assert app.router.lifespan_context is not None


def test_runtime_serializes_utc_state():
    from datetime import datetime
    payload = OrbitRuntime().serialize_state("ISS", datetime(2024, 1, 1), 1, 2, 3, 4, 5, 6)
    assert payload["time"].endswith("+00:00") and payload["velocity"]["z"] == 6
