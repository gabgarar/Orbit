import assert from "node:assert/strict";
import test from "node:test";

import {
    getStartupProjectReadiness,
    isStartupTerminal,
    mergeStartupStatus,
    normalizeStartupProgress,
    normalizeStartupStatus,
    publishStartupStatus,
    STARTUP_STATUS_EVENT,
    STARTUP_STEP_ORDER,
    startupStatusFromDiagnosticComponent
} from "../../js/features/diagnostics/startupStatus.js";

test("startup status normalizes a service lifecycle in its documented sequence", () => {
    const startup = normalizeStartupStatus({
        status: "ready",
        details: {
            started_at: "2026-08-14T10:00:00Z",
            completed_at: "2026-08-14T10:00:04Z",
            steps: [
                { id: "time_manager", status: "ok", message: "MTR initialized" },
                { id: "gravity_models", status: "warning", message: "EGM2008 pending update" },
                { id: "eop", status: "passed" },
                { id: "config", status: "healthy" },
                { id: "gravity_validation", status: "ready" }
            ],
            warnings: ["EGM2008 pending update"]
        }
    });

    assert.equal(startup.status, "healthy");
    assert.equal(startup.startedAt, "2026-08-14T10:00:00Z");
    assert.equal(startup.completedAt, "2026-08-14T10:00:04Z");
    assert.deepEqual(startup.steps.map((step) => step.id), [
        "configuration", "erp", "gravity", "gravity-validation", "mtr"
    ]);
    assert.equal(startup.steps.find((step) => step.id === "gravity")?.status, "warning");
    assert.deepEqual(startup.warnings, ["EGM2008 pending update"]);
    assert.equal(isStartupTerminal(startup), true);
    assert.deepEqual(STARTUP_STEP_ORDER.slice(0, 3), ["configuration", "erp", "gravity"]);
});

test("startup updates append by step without inventing a completed ERP or gravity check", () => {
    const initial = mergeStartupStatus(null, {
        source: "frontend-runtime",
        status: "running",
        step: { id: "configuration", status: "healthy", message: "Loaded" }
    });
    const next = mergeStartupStatus(initial, {
        source: "system-diagnostics",
        step: { id: "gravity-download", status: "pending", message: "Downloading EGM2008" }
    });

    assert.equal(next.status, "pending");
    assert.equal(next.steps.find((step) => step.id === "configuration")?.status, "healthy");
    assert.equal(next.steps.find((step) => step.id === "gravity-download")?.status, "pending");
    assert.equal(next.steps.some((step) => step.id === "erp"), false);
    assert.equal(isStartupTerminal(next), false);
});

test("startup state is cached and re-emitted for a late React consumer", () => {
    const windowRef = new EventTarget();
    windowRef.CustomEvent = globalThis.CustomEvent;
    const events = [];
    windowRef.addEventListener(STARTUP_STATUS_EVENT, (event) => events.push(event.detail));

    const first = publishStartupStatus({
        source: "frontend-runtime",
        status: "running",
        step: { id: "mtr", status: "pending" }
    }, windowRef);
    const finished = publishStartupStatus({
        source: "system-diagnostics",
        status: "healthy",
        completed_at: "2026-08-14T10:00:05Z",
        step: { id: "complete", status: "healthy" }
    }, windowRef);

    assert.equal(windowRef.__orbitStartupStatus, finished);
    assert.equal(events.length, 2);
    assert.equal(first.steps[0].id, "mtr");
    assert.equal(isStartupTerminal(finished), true);
});

test("startup diagnostic components preserve their own published details", () => {
    const startup = startupStatusFromDiagnosticComponent({
        status: "warning",
        lastValidatedAt: "2026-08-14T10:00:06Z",
        details: {
            steps: [{ id: "gravity", status: "warning" }],
            warnings: ["EGM96 cache is stale"]
        }
    });

    assert.equal(startup.status, "warning");
    assert.equal(startup.updatedAt, "2026-08-14T10:00:06Z");
    assert.equal(startup.steps[0].id, "gravity");
    assert.deepEqual(startup.warnings, ["EGM96 cache is stale"]);
});

test("startup preserves a service pending state instead of rendering it as a generic warning", () => {
    const startup = startupStatusFromDiagnosticComponent({
        // The general diagnostics normalizer has already mapped the card
        // status to warning, while it retains the service value in details.
        status: "warning",
        details: {
            status: "pending",
            steps: [{ id: "gravity-validation", status: "pending" }]
        }
    });

    assert.equal(startup.status, "pending");
    assert.equal(isStartupTerminal(startup), false);
});

test("startup readiness is fail-closed and keeps exact NGA download progress", () => {
    const pending = normalizeStartupStatus({
        status: "ready",
        details: {
            progress: {
                state: "downloading",
                currentModel: "EGM2008",
                completedModels: 1,
                totalModels: 2,
                models: {
                    EGM2008: {
                        state: "downloading",
                        bytesDownloaded: 52_428_800,
                        totalBytes: 104_857_600
                    }
                }
            }
        }
    });

    assert.equal(pending.status, "healthy", "generic health must not unlock projects");
    assert.equal(getStartupProjectReadiness(pending).ready, false);
    assert.equal(pending.progress.percent, 50);
    assert.equal(pending.progress.models[0].percent, 50);
    assert.equal(pending.progress.models[0].bytesDownloaded, 52_428_800);

    const completed = normalizeStartupStatus({
        status: "warning",
        ready: true,
        readiness: { state: "degraded-ready", message: "ERP nominal activo" },
        details: { progress: { state: "ready", percent: 100 } }
    });
    assert.equal(getStartupProjectReadiness(completed).ready, true);
    assert.equal(getStartupProjectReadiness(completed).state, "ready");
    assert.equal(normalizeStartupProgress(completed).percent, 100);
});

test("partial startup events retain explicit ready only when the service has published it", () => {
    const ready = mergeStartupStatus(null, { ready: true, readiness: { state: "ready" } });
    const updated = mergeStartupStatus(ready, {
        status: "warning",
        step: { id: "erp", status: "warning", message: "Nominal fallback" }
    });
    assert.equal(getStartupProjectReadiness(updated).ready, true);

    const blocked = mergeStartupStatus(updated, { ready: false, readiness: { state: "blocked" } });
    assert.equal(getStartupProjectReadiness(blocked).ready, false);
});
