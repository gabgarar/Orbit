"""Tests for the ASGI composition root and executable entry point."""

from pathlib import Path
import hashlib

from fastapi import APIRouter

import orbit_api.bootstrap as bootstrap
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


def test_application_wires_the_statevector_realtime_callback(monkeypatch):
    captured: dict[str, object] = {}

    def realtime_router(*args):
        captured["args"] = args
        return APIRouter()

    monkeypatch.setattr(bootstrap, "create_realtime_router", realtime_router)
    bootstrap.create_app()

    callback = captured["args"][3]
    assert callable(callback)
    assert callback.__name__ == "build_realtime_state"


def test_application_installs_a_nonblocking_automatic_c01_provider_only_without_explicit_c04(tmp_path, monkeypatch):
    cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    monkeypatch.setenv("ORBIT_EOP_C04_PATH", "")
    monkeypatch.setenv("ORBIT_EOP_STRICT", "")
    monkeypatch.setenv("ORBIT_EOP_C01_CACHE_PATH", str(cache))
    app = create_app()

    assert app.state.automatic_eop_cache is not None
    assert app.state.automatic_eop_cache.cache_path == cache
    # App construction does not await IERS/network work; the worker is only
    # scheduled by lifespan, so creating the ASGI app does not create a file.
    assert not cache.exists()
    assert app.state.system_diagnostics.payload()["components"]["erp"]["automatic"] is True


def test_application_wires_a_separate_nonblocking_finals2000a_cache(tmp_path, monkeypatch):
    c01_cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    finals_cache = tmp_path / "data" / "erp" / "finals2000A.all"
    monkeypatch.setenv("ORBIT_EOP_C04_PATH", "")
    monkeypatch.setenv("ORBIT_EOP_STRICT", "")
    monkeypatch.setenv("ORBIT_EOP_C01_CACHE_PATH", str(c01_cache))
    monkeypatch.setenv("ORBIT_FINALS2000A_CACHE_PATH", str(finals_cache))

    app = create_app()

    automatic = app.state.automatic_eop_cache
    assert automatic is not None
    assert automatic.cache_path == c01_cache
    assert automatic.finals_cache_path == finals_cache
    erp = app.state.system_diagnostics.payload()["components"]["erp"]
    assert erp["selection"]["policy"] == "c01-then-finals2000A-then-bounded-linear-tail-then-nominal"
    assert not c01_cache.exists()
    assert not finals_cache.exists()


def test_application_registers_nga_gravity_cache_without_downloading_during_boot(tmp_path, monkeypatch):
    cache_root = tmp_path / "data" / "geopotential"
    monkeypatch.setenv("ORBIT_GRAVITY_CACHE_DIR", str(cache_root))
    monkeypatch.setenv("ORBIT_GRAVITY_MODEL", "EGM96")
    monkeypatch.setenv("ORBIT_GRAVITY_REFRESH_DAYS", "14")
    monkeypatch.setenv("ORBIT_GRAVITY_AUTO_DOWNLOAD", "true")
    monkeypatch.setenv("ORBIT_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS", "12")

    app = create_app()

    registry = app.state.gravity_model_registry
    assert registry.cache_root == cache_root
    assert registry.active_model == "EGM96"
    assert registry.refresh_age.days == 14
    assert registry.timeout_seconds == 12
    # Registry construction publishes a pending diagnostic only. The monitor
    # owns local validation/download after ASGI lifespan startup.
    assert not cache_root.exists()
    gravity = app.state.system_diagnostics.payload()["components"]["gravity"]
    assert gravity["activeModel"] == "EGM96"
    assert gravity["models"]["EGM96"]["refreshDue"] is True


def test_application_exposes_a_pending_startup_ledger_without_starting_background_work(tmp_path, monkeypatch):
    cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    monkeypatch.setenv("ORBIT_EOP_C04_PATH", "")
    monkeypatch.setenv("ORBIT_EOP_STRICT", "")
    monkeypatch.setenv("ORBIT_EOP_C01_CACHE_PATH", str(cache))

    app = create_app()
    startup = app.state.system_diagnostics.payload()["components"]["startup"]

    assert startup["status"] == "pending"
    assert startup["details"]["completedAt"] is None
    assert startup["details"]["steps"][0]["id"] == "configuration"
    # Creating the ASGI application only publishes facts. Network/cache work
    # belongs to the daemon monitor after lifespan startup.
    assert not cache.exists()


def test_application_keeps_an_explicit_c04_out_of_the_automatic_cache(tmp_path, monkeypatch):
    snapshot = tmp_path / "eopc04.txt"
    snapshot.write_text(
        "2026 7 26 61247 0.12 -0.23 0.345 0.001 0.01 -0.02\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ORBIT_EOP_C04_PATH", str(snapshot))
    monkeypatch.setenv("ORBIT_EOP_STRICT", "")
    monkeypatch.delenv("ORBIT_EOP_C01_CACHE_PATH", raising=False)
    app = create_app()

    assert app.state.automatic_eop_cache is None
    erp = app.state.system_diagnostics.payload()["components"]["erp"]
    assert erp["automatic"] is False
    assert erp["loaded"] is True


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
