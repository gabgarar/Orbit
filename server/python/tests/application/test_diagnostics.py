"""Bounded Built-In Test backend diagnostics contracts."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from orbit_api.application.diagnostics import (
    GitHubActionsDiagnostics,
    SystemDiagnostics,
    SystemHealthMonitor,
)
from orbit_api.frames import FrameTransformService
from orbit_api.orbits.forces import GravityFieldModel
from orbit_api.timekeeping import IersEopCacheService


def _mjd(moment: datetime) -> float:
    return (moment - datetime(1858, 11, 17, tzinfo=UTC)).total_seconds() / 86_400.0


def _c01_row(moment: datetime, ut1_tai: float) -> str:
    values = [f"{_mjd(moment):.5f}", "0.12", "-0.23", f"{ut1_tai:.7f}", "0.01", "-0.02"]
    values.extend("0" for _ in range(15))
    values.append("-0.000711")
    return " ".join(values)


def _c01(now: datetime) -> bytes:
    return (
        "COMB EARTH ROTATION DATA\n"
        "MJD PM-X PM-Y UT1-TAI DX DY XERR YERR UTERR DXERR DYERR C1 C2 C3 C4 C5 C6 C7 C8 XRT YRT LOD DXRT DYRT\n"
        f"{_c01_row(now, -36.8)}\n{_c01_row(now + timedelta(days=1), -36.79)}\n"
    ).encode()


def test_diagnostics_reports_canonical_components_and_does_not_fake_optional_force_health(tmp_path):
    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    cache.write_bytes(_c01(now))
    os.utime(cache, (now.timestamp(), now.timestamp()))
    cache_service = IersEopCacheService(cache, fetcher=lambda *_: b"unused", now=lambda: now)
    cache_service.refresh_if_needed()
    transformer = FrameTransformService(cache_service)
    diagnostics = SystemDiagnostics(
        frame_transformer=transformer,
        eop_cache=cache_service,
        now=lambda: now,
    )

    diagnostics.run_checks()
    payload = diagnostics.payload()

    assert payload["generatedAt"] == now.isoformat()
    assert {"erp", "sp3", "oem", "propagators", "forces", "frames", "cicd", "monitor"} <= set(payload["components"])
    assert payload["components"]["erp"]["loaded"] is True
    assert payload["components"]["sp3"]["status"] == "ok"
    assert payload["components"]["oem"]["status"] == "ok"
    assert payload["components"]["propagators"]["status"] == "ok"
    # Full geopotential/drag/SRP require configured local physics/time data;
    # absence is visible as warning, never fabricated as healthy.
    assert payload["components"]["forces"]["status"] == "warning"
    assert payload["components"]["cicd"]["status"] == "unknown"
    for component in payload["components"].values():
        assert "lastValidation" in component and "details" in component


def test_diagnostics_exposes_the_active_checksum_pinned_icgem_as_a_model_option():
    now = datetime(2026, 7, 26, tzinfo=UTC)
    diagnostics = SystemDiagnostics(
        frame_transformer=FrameTransformService(),
        gravity_field=GravityFieldModel.wgs84_zonal_degree4(),
        now=lambda: now,
    )

    diagnostics.run_checks()
    gravity = diagnostics.payload()["components"]["gravity"]
    local = gravity["details"]["models"]["LOCAL_ICGEM"]

    assert gravity["activeModel"] == "LOCAL_ICGEM"
    assert local["available"] is True
    assert local["maxDegree"] == 4
    assert local["coefficientMaxDegree"] == 4
    assert local["coefficientMaxOrder"] == 4
    assert local["degreeCoverage"][0]["orderRule"] == "degree"
    assert local["executionLimit"]["maxHarmonicTerms"] == 2555


def test_static_icgem_keeps_gravity_aggregate_healthy_when_an_nga_card_failed():
    class FailedNGARegistry:
        def diagnostics_payload(self):
            return {
                "status": "error",
                "activeModel": "EGM2008",
                "automatic": True,
                "cacheRoot": "/tmp/gravity",
                "models": {"EGM2008": {"id": "EGM2008", "status": "error", "loaded": False}},
                "error": "NGA unavailable",
            }

    now = datetime(2026, 7, 26, tzinfo=UTC)
    diagnostics = SystemDiagnostics(
        frame_transformer=FrameTransformService(),
        gravity_field=GravityFieldModel.wgs84_zonal_degree4(),
        gravity_models=FailedNGARegistry(),
        now=lambda: now,
    )

    diagnostics.run_checks()
    gravity = diagnostics.payload()["components"]["gravity"]
    assert gravity["status"] == "warning"
    assert gravity["activeModel"] == "LOCAL_ICGEM"
    assert gravity["details"]["models"]["EGM2008"]["status"] == "error"
    assert gravity["details"]["models"]["LOCAL_ICGEM"]["available"] is True


def test_monitor_refreshes_eop_in_its_worker_cycle_without_network_in_transform_calls(tmp_path):
    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    calls: list[str] = []
    cache_service = IersEopCacheService(
        cache,
        fetcher=lambda *_: calls.append("download") or _c01(now),
        now=lambda: now,
    )
    transformer = FrameTransformService(cache_service)
    diagnostics = SystemDiagnostics(frame_transformer=transformer, eop_cache=cache_service, now=lambda: now)
    monitor = SystemHealthMonitor(diagnostics, eop_cache=cache_service, interval_seconds=30, now=lambda: now)

    # Before monitor work there is no file and the transformer remains a pure
    # read path; after one explicit monitor cycle the validated provider is
    # active and diagnostics shows its cache provenance.
    assert transformer.earth_orientation_at(now).quality == "approximate"
    monitor.run_once()

    payload = diagnostics.payload()
    assert calls == ["download"]
    assert cache.exists()
    assert payload["components"]["erp"]["status"] == "ok"
    assert payload["components"]["monitor"]["lastValidation"] == now.isoformat()


def test_monitor_publishes_a_terminal_startup_ledger_without_blocking_health_work(tmp_path):
    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "data" / "erp" / "EOP_C01_IAU2000_1846-now.txt"
    cache.parent.mkdir(parents=True)
    cache.write_bytes(_c01(now))
    os.utime(cache, (now.timestamp(), now.timestamp()))
    cache_service = IersEopCacheService(cache, fetcher=lambda *_: b"unused", now=lambda: now)
    diagnostics = SystemDiagnostics(
        frame_transformer=FrameTransformService(cache_service),
        eop_cache=cache_service,
        now=lambda: now,
    )
    monitor = SystemHealthMonitor(diagnostics, eop_cache=cache_service, interval_seconds=30, now=lambda: now)

    before = diagnostics.payload()["components"]["startup"]
    assert before["status"] == "pending"
    assert before["details"]["completedAt"] is None

    monitor.run_once()

    startup = diagnostics.payload()["components"]["startup"]
    ids = [step["id"] for step in startup["details"]["steps"]]
    assert ids[:3] == ["configuration", "erp", "gravity"]
    assert ids[-1] == "complete"
    assert startup["details"]["completedAt"] == now.isoformat()


def test_monitor_records_real_gravity_download_and_validation_steps_when_refresh_is_due(tmp_path):
    class FakeGravityRegistry:
        def __init__(self) -> None:
            self.refreshed = False

        def refresh_if_needed(self):
            self.refreshed = True
            return {}

        def diagnostics_payload(self):
            status = "ok" if self.refreshed else "warning"
            return {
                "status": status,
                "activeModel": "EGM2008",
                "automatic": True,
                "cacheRoot": "fixture",
                "models": {
                    "EGM96": {"status": status, "refreshDue": not self.refreshed},
                    "EGM2008": {"status": status, "refreshDue": not self.refreshed},
                },
                "error": None,
            }

    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    cache.write_bytes(_c01(now))
    os.utime(cache, (now.timestamp(), now.timestamp()))
    cache_service = IersEopCacheService(cache, fetcher=lambda *_: b"unused", now=lambda: now)
    registry = FakeGravityRegistry()
    diagnostics = SystemDiagnostics(
        frame_transformer=FrameTransformService(cache_service),
        eop_cache=cache_service,
        gravity_models=registry,  # type: ignore[arg-type]
        now=lambda: now,
    )
    monitor = SystemHealthMonitor(
        diagnostics,
        eop_cache=cache_service,
        gravity_models=registry,  # type: ignore[arg-type]
        interval_seconds=30,
        now=lambda: now,
    )

    monitor.run_once()

    steps = diagnostics.payload()["components"]["startup"]["details"]["steps"]
    by_id = {step["id"]: step for step in steps}
    assert registry.refreshed is True
    assert by_id["gravity-download"]["status"] == "ok"
    assert by_id["gravity-validation"]["status"] == "ok"
    assert by_id["gravity"]["status"] == "ok"


def test_monitor_blocks_project_readiness_when_any_nga_model_fails_startup_validation(tmp_path):
    class FailedGravityRegistry:
        def __init__(self) -> None:
            self.refreshed = False

        def refresh_if_needed(self):
            self.refreshed = True
            return {}

        def diagnostics_payload(self):
            failure = self.refreshed
            return {
                "status": "warning",
                "activeModel": "EGM2008",
                "automatic": True,
                "cacheRoot": "fixture",
                "models": {
                    "EGM96": {"status": "ok", "refreshDue": not failure},
                    "EGM2008": {
                        "status": "warning",
                        "refreshDue": True,
                        "error": "NGA connection unavailable" if failure else None,
                    },
                },
                "progress": {
                    "state": "error" if failure else "pending",
                    "currentModel": "EGM2008",
                    "completedModels": 1 if failure else 0,
                    "totalModels": 2,
                    "percent": 50 if failure else 0,
                    "models": {},
                },
                "error": "EGM2008: NGA connection unavailable" if failure else None,
            }

    now = datetime(2026, 7, 26, tzinfo=UTC)
    cache = tmp_path / "EOP_C01_IAU2000_1846-now.txt"
    cache.write_bytes(_c01(now))
    os.utime(cache, (now.timestamp(), now.timestamp()))
    eop = IersEopCacheService(cache, fetcher=lambda *_: b"unused", now=lambda: now)
    registry = FailedGravityRegistry()
    diagnostics = SystemDiagnostics(
        frame_transformer=FrameTransformService(eop),
        eop_cache=eop,
        gravity_models=registry,  # type: ignore[arg-type]
        now=lambda: now,
    )
    monitor = SystemHealthMonitor(
        diagnostics,
        eop_cache=eop,
        gravity_models=registry,  # type: ignore[arg-type]
        interval_seconds=30,
        now=lambda: now,
    )

    monitor.run_once()

    startup = diagnostics.payload()["components"]["startup"]
    assert startup["projectReady"] is False
    assert startup["readiness"]["state"] == "blocked"
    assert startup["details"]["progress"]["state"] == "error"
    assert {entry["id"] for entry in startup["readiness"]["blockers"]} >= {
        "gravity-download", "gravity-validation", "gravity", "complete",
    }


def test_monitor_uses_bounded_backoff_for_a_blocked_first_startup_cycle():
    now = datetime(2026, 7, 26, tzinfo=UTC)
    diagnostics = SystemDiagnostics(frame_transformer=FrameTransformService(), now=lambda: now)
    diagnostics.mark_startup_step("erp", "ok")
    diagnostics.mark_startup_step("gravity-download", "error", message="NGA offline")
    diagnostics.mark_startup_step("gravity-validation", "error", message="No valid archive")
    diagnostics.mark_startup_step("gravity", "error", message="No valid archive")
    diagnostics.complete_startup("error", message="NGA unavailable")
    monitor = SystemHealthMonitor(diagnostics, interval_seconds=3600, now=lambda: now)

    attempts = [monitor._next_wait_after_cycle() for _ in range(6)]

    assert attempts[:5] == [
        (30.0, True),
        (60.0, True),
        (120.0, True),
        (240.0, True),
        (300.0, True),
    ]
    assert attempts[5] == (3600.0, False)


def test_monitor_recovers_a_terminal_nga_block_on_a_later_normal_cycle():
    """The bounded retry cap must not latch a now-valid gravity cache forever."""

    class RecoveringGravityRegistry:
        active_model = "EGM2008"

        def __init__(self) -> None:
            self.healthy = False
            self.refresh_calls = 0

        def refresh_if_needed(self):
            self.refresh_calls += 1
            self.healthy = True
            return {}

        def diagnostics_payload(self):
            status = "ok" if self.healthy else "warning"
            return {
                "status": status,
                "activeModel": self.active_model,
                "automatic": True,
                "cacheRoot": "fixture",
                "models": {
                    model_id: {
                        "status": status,
                        "loaded": self.healthy,
                        "available": self.healthy,
                        "refreshDue": not self.healthy,
                    }
                    for model_id in ("EGM96", "EGM2008")
                },
                "progress": {
                    "state": "ready" if self.healthy else "error",
                    "completedModels": 2 if self.healthy else 0,
                    "totalModels": 2,
                    "percent": 100 if self.healthy else 0,
                    "models": {},
                },
                "error": None,
            }

        def record(self, _model_id):
            # Optional-force diagnostics only need these two attributes.
            return SimpleNamespace(available=False, inspection=None)

    now = datetime(2026, 7, 26, tzinfo=UTC)
    registry = RecoveringGravityRegistry()
    diagnostics = SystemDiagnostics(
        frame_transformer=FrameTransformService(),
        eop_payload=lambda: {"status": "ok", "error": None},
        gravity_models=registry,  # type: ignore[arg-type]
        now=lambda: now,
    )
    diagnostics.mark_startup_step("erp", "ok")
    diagnostics.mark_startup_step("gravity-download", "error", message="NGA offline")
    diagnostics.mark_startup_step("gravity-validation", "error", message="NGA offline")
    diagnostics.mark_startup_step("gravity", "error", message="NGA offline")
    diagnostics.complete_startup("error", message="NGA unavailable")
    monitor = SystemHealthMonitor(
        diagnostics,
        gravity_models=registry,  # type: ignore[arg-type]
        interval_seconds=3600,
        now=lambda: now,
    )
    # Simulate the state after all five bounded fast retries have already
    # been consumed. The next ordinary monitor cycle must be able to recover.
    monitor._startup_retry_attempts = 5
    assert monitor._next_wait_after_cycle() == (3600.0, False)

    monitor.run_once()

    startup = diagnostics.payload()["components"]["startup"]
    steps = {step["id"]: step for step in startup["details"]["steps"]}
    assert registry.refresh_calls == 1
    assert startup["projectReady"] is True
    assert startup["readiness"]["state"] == "ready"
    assert steps["gravity-download"]["status"] == "ok"
    assert steps["gravity-validation"]["status"] == "ok"
    assert steps["gravity"]["status"] == "ok"
    assert steps["complete"]["status"] == "ok"


def test_optional_github_actions_probe_is_injected_and_never_requires_a_token():
    def fetcher(url: str, _timeout: float, _max_bytes: int) -> bytes:
        workflow = url.split("/workflows/", 1)[1].split("/", 1)[0]
        return json.dumps({
            "workflow_runs": [{
                "status": "completed",
                "conclusion": "success",
                "updated_at": "2026-07-26T00:00:00Z",
                "html_url": f"https://github.com/gabgarar/Orbit/actions/{workflow}",
            }]
        }).encode()

    check = GitHubActionsDiagnostics(enabled=True, fetcher=fetcher)
    component = check.probe(datetime(2026, 7, 26, tzinfo=UTC))

    assert component["status"] == "ok"
    assert set(component["details"]["workflows"]) == {"quality.yml", "docs-pages.yml", "release.yml"}
