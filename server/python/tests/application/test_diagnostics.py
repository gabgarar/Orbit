"""Bounded Built-In Test backend diagnostics contracts."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import os

from orbit_api.application.diagnostics import (
    GitHubActionsDiagnostics,
    SystemDiagnostics,
    SystemHealthMonitor,
)
from orbit_api.frames import FrameTransformService
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
