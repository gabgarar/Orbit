"""Contracts for the non-blocking startup diagnostics ledger."""

from datetime import UTC, datetime, timedelta

from orbit_api.application.startup_status import StartupStatusReporter


def test_startup_reporter_preserves_real_steps_without_marking_pending_work_healthy():
    instant = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
    reporter = StartupStatusReporter(now=lambda: instant)

    reporter.record("configuration", "ok", message="Configuration loaded")
    reporter.record("erp", "running", message="Waiting for IERS cache")
    reporter.record("gravity", "pending")

    payload = reporter.payload()

    assert payload["status"] == "pending"
    assert payload["details"]["completedAt"] is None
    steps = payload["details"]["steps"]
    assert [step["id"] for step in steps] == ["configuration", "erp", "gravity"]
    assert steps[0]["status"] == "ok"
    assert steps[1]["status"] == "pending"
    assert steps[2]["status"] == "pending"


def test_startup_reporter_surfaces_warnings_and_closes_only_explicitly():
    clock = [datetime(2026, 8, 14, 10, 0, tzinfo=UTC)]
    reporter = StartupStatusReporter(now=lambda: clock[0])

    reporter.record("erp", "warning", message="Using validated cached EOP data")
    clock[0] += timedelta(seconds=1)
    reporter.complete("warning", message="Orbit started with operational warnings")

    payload = reporter.payload()

    assert payload["status"] == "warning"
    assert payload["details"]["completedAt"] == clock[0].isoformat()
    assert payload["details"]["warnings"] == [
        "Using validated cached EOP data",
        "Orbit started with operational warnings",
    ]
    assert payload["details"]["steps"][-1]["id"] == "complete"


def test_startup_reporter_bounds_and_records_failure_message():
    instant = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
    reporter = StartupStatusReporter(now=lambda: instant)

    reporter.record("gravity-validation", "failed", message="x" * 700)
    reporter.complete("error", message="Startup did not complete")

    payload = reporter.payload()

    assert payload["status"] == "error"
    assert len(payload["details"]["errors"][0]) == 500
    assert payload["error"] == payload["details"]["errors"][0]


def test_project_readiness_waits_for_every_nga_step_and_allows_documented_erp_degradation():
    instant = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
    reporter = StartupStatusReporter(now=lambda: instant)

    reporter.record("configuration", "ok")
    reporter.record("erp", "pending")
    reporter.record("gravity-download", "pending")
    reporter.record("gravity-validation", "pending")
    reporter.record("gravity", "pending")

    pending = reporter.readiness_payload()
    assert pending["state"] == "pending"
    assert pending["projectReady"] is False
    assert {entry["id"] for entry in pending["pending"]} >= {
        "erp", "gravity-download", "gravity-validation", "gravity", "complete",
    }

    reporter.record("erp", "warning", message="IERS unavailable; nominal rotation is labelled")
    reporter.record("gravity-download", "ok")
    reporter.record("gravity-validation", "ok")
    reporter.record("gravity", "ok")
    reporter.complete("warning")

    degraded = reporter.payload()
    assert degraded["projectReady"] is True
    assert degraded["readiness"]["state"] == "degraded-ready"
    assert degraded["readiness"]["degradations"][0]["id"] == "erp"


def test_project_readiness_blocks_a_failed_or_stale_nga_validation_even_after_completion():
    instant = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
    reporter = StartupStatusReporter(now=lambda: instant)

    reporter.record("configuration", "ok")
    reporter.record("erp", "ok")
    reporter.record("gravity-download", "warning", message="EGM2008 refresh failed")
    reporter.record("gravity-validation", "warning", message="Cached EGM2008 is stale")
    reporter.record("gravity", "warning")
    reporter.complete("error", message="NGA startup resources are not all valid")

    readiness = reporter.readiness_payload()
    assert readiness["state"] == "blocked"
    assert readiness["projectReady"] is False
    assert {entry["id"] for entry in readiness["blockers"]} >= {
        "gravity-download", "gravity-validation", "gravity", "complete",
    }


def test_startup_retry_reopens_a_failed_cycle_and_can_recover_to_ready():
    instant = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
    reporter = StartupStatusReporter(now=lambda: instant)
    reporter.record("configuration", "ok")
    reporter.record("erp", "ok")
    reporter.record("gravity-download", "error", message="NGA offline")
    reporter.record("gravity-validation", "error")
    reporter.record("gravity", "error")
    reporter.complete("error", message="Initial NGA transfer failed")
    assert reporter.readiness_payload()["state"] == "blocked"

    reporter.reopen()
    reporter.record("configuration", "ok")
    reporter.record("erp", "ok")
    reporter.record("gravity-download", "ok")
    reporter.record("gravity-validation", "ok")
    reporter.record("gravity", "ok")
    reporter.complete("ok")

    recovered = reporter.payload()
    assert recovered["status"] == "ok"
    assert recovered["error"] is None
    assert recovered["projectReady"] is True
    assert recovered["readiness"]["state"] == "ready"
