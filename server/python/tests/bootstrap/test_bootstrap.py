"""Tests for the ASGI composition root and executable entry point."""

from pathlib import Path
import hashlib

from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.bootstrap import create_app
from orbit_api.timekeeping import configure_default_leap_second_table, default_leap_second_table


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


def test_application_loads_an_opt_in_local_leap_second_snapshot_at_startup(tmp_path, monkeypatch):
    contents = b"#@ 4039286400\n3692217600 37 # 1 Jan 2017\n4007750400 38 # 1 Jan 2027\n"
    snapshot = tmp_path / "leap-seconds.list"
    snapshot.write_bytes(contents)
    previous = default_leap_second_table()
    monkeypatch.setenv("ORBIT_EOP_STRICT", "")
    monkeypatch.setenv("ORBIT_LEAP_SECONDS_PATH", str(snapshot))
    monkeypatch.setenv("ORBIT_LEAP_SECONDS_SHA256", hashlib.sha256(contents).hexdigest())
    monkeypatch.setenv("ORBIT_LEAP_SECONDS_VERSION", "bootstrap-fixture")
    try:
        create_app()
        assert default_leap_second_table().version == "bootstrap-fixture"
    finally:
        configure_default_leap_second_table(previous)
