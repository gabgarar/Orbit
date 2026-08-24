import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSystemDiagnosticsPayload } from "../../js/features/diagnostics/diagnosticsContract.js";
import {
    continuousBitStatus,
    initialBitWarningMessages,
    initialBitWarningNotice,
    initialBitSummary,
    visibleBitComponents
} from "../../js/features/diagnostics/bitPresentation.js";
import { buildBitDashboard } from "../../js/features/diagnostics/bitDashboardPresentation.js";

function diagnosticsFixture(overrides = {}) {
    return normalizeSystemDiagnosticsPayload({
        status: "ok",
        components: {
            startup: {
                status: "ok",
                ready: true,
                details: {
                    startedAt: "2026-08-16T10:00:00Z",
                    completedAt: "2026-08-16T10:01:00Z",
                    readiness: { state: "ready", blockers: [] },
                    steps: [
                        { id: "configuration", status: "ok", timestamp: "2026-08-16T10:00:00Z" },
                        { id: "complete", status: "ok", timestamp: "2026-08-16T10:01:00Z" }
                    ]
                }
            },
            monitor: { status: "ok", details: { running: true } },
            erp: { status: "ok" },
            gravity: { status: "ok" },
            propagators: { status: "ok" },
            forces: { status: "ok" },
            frames: { status: "ok" },
            sp3: { status: "warning", details: { loadedProducts: 0 } },
            oem: { status: "warning" },
            mtr: { status: "warning" },
            // A GitHub result must never change the operational BIT verdict.
            cicd: { status: "error" },
            ...overrides
        }
    });
}

test("continuous BIT renders only relevant scene components and omits CI/CD", () => {
    const diagnostics = diagnosticsFixture();
    const hidden = visibleBitComponents({ diagnostics, local: null }).map(({ id }) => id);

    assert.deepEqual(hidden, ["monitor", "erp", "gravity", "propagators", "forces", "frames"]);
    assert.equal(hidden.includes("sp3"), false);
    assert.equal(hidden.includes("oem"), false);
    assert.equal(hidden.includes("mtr"), false);
    assert.equal(hidden.includes("cicd"), false);

    const shown = visibleBitComponents({
        diagnostics,
        local: {
            sp3: { activeCount: 1, status: "healthy" },
            oem: { activeCount: 1, status: "healthy" },
            mtr: { active: true, status: "healthy" }
        }
    }).map(({ id }) => id);
    assert.deepEqual(shown, ["monitor", "erp", "gravity", "sp3", "oem", "propagators", "forces", "mtr", "frames"]);
});

test("a persisted SP3 cache does not appear in BIT until a scene layer is active", () => {
    const diagnostics = diagnosticsFixture({
        sp3: { status: "healthy", details: { loadedProducts: 3 } }
    });

    const componentIds = visibleBitComponents({ diagnostics, local: null })
        .map(({ id }) => id);

    assert.equal(componentIds.includes("sp3"), false);
});

test("continuous BIT status ignores CI/CD and absent optional-parser warnings", () => {
    const diagnostics = diagnosticsFixture();

    assert.equal(continuousBitStatus({ availability: "available", diagnostics, local: null }), "healthy");
    assert.equal(continuousBitStatus({ availability: "unavailable", diagnostics, local: null }), "warning");
});

test("the BIT dashboard separates service liveness, PBIT, time, and runtime validation sections", () => {
    const diagnostics = diagnosticsFixture();
    const dashboard = buildBitDashboard({
        availability: "available",
        diagnostics,
        runtimeHealth: {
            availability: "available",
            gatewayStatus: "healthy",
            pythonBackendStatus: "healthy"
        }
    });

    assert.deepEqual(dashboard.sections.map(({ id }) => id), ["services", "time", "runtime"]);
    assert.deepEqual(dashboard.sections[0].rows.map(({ id }) => id), [
        "gateway", "python-backend", "diagnostics-api", "monitor"
    ]);
    assert.equal(dashboard.summaries.services.status, "healthy");
    assert.equal(dashboard.pbit.result, "Superado");
    assert.equal(dashboard.summaries.pbit.projectReady, true);
    assert.equal(dashboard.summaries.time.status, "healthy");
    assert.equal(dashboard.summaries.runtime.status, "healthy");
    assert.equal(dashboard.sections.some(({ id }) => id === "scene"), false,
        "inactive cached products must not occupy the operator dashboard");
});

test("the BIT dashboard keeps a time warning separate from healthy service liveness", () => {
    const diagnostics = diagnosticsFixture({
        erp: { status: "warning", message: "finals2000A usa predicción" }
    });
    const dashboard = buildBitDashboard({
        availability: "available",
        diagnostics,
        runtimeHealth: {
            availability: "available",
            gatewayStatus: "healthy",
            pythonBackendStatus: "healthy"
        }
    });

    assert.equal(dashboard.summaries.services.status, "healthy");
    assert.equal(dashboard.summaries.time.status, "warning");
    assert.equal(dashboard.status, "warning");
    assert.equal(dashboard.issues.some(({ id, sectionId }) => id === "erp" && sectionId === "time"), true);
});

test("the BIT dashboard keeps an unqueried service health check pending instead of reporting a false outage", () => {
    const dashboard = buildBitDashboard({
        availability: "loading",
        diagnostics: null,
        runtimeHealth: null
    });

    const services = dashboard.sections.find(({ id }) => id === "services");
    assert.equal(services.rows.find(({ id }) => id === "gateway")?.status, "warning");
    assert.equal(services.rows.find(({ id }) => id === "python-backend")?.status, "warning");
    assert.equal(services.summary.error, 0);
});

test("the BIT dashboard adds scene data only when the matching sources are active", () => {
    const diagnostics = diagnosticsFixture();
    const dashboard = buildBitDashboard({
        availability: "available",
        diagnostics,
        runtimeHealth: {
            availability: "available",
            gatewayStatus: "healthy",
            pythonBackendStatus: "healthy"
        },
        local: {
            sp3: { activeCount: 1, status: "healthy" },
            oem: { activeCount: 1, status: "healthy" },
            mtr: { active: true, status: "healthy" }
        }
    });

    assert.deepEqual(dashboard.sections.find(({ id }) => id === "scene")?.rows.map(({ id }) => id), ["sp3", "oem"]);
    assert.equal(dashboard.sections.find(({ id }) => id === "time")?.rows.some(({ id }) => id === "mtr"), true);
});

test("IBIT is only marked passed after an explicit terminal ready ledger", () => {
    const passed = initialBitSummary(diagnosticsFixture());
    assert.equal(passed.status, "healthy");
    assert.equal(passed.result, "Superado");
    assert.equal(passed.passed, true);

    const pending = initialBitSummary(diagnosticsFixture({
        startup: {
            status: "pending",
            ready: false,
            details: {
                startedAt: "2026-08-16T10:00:00Z",
                readiness: { state: "pending", blockers: [] },
                steps: [{ id: "gravity-download", status: "pending" }]
            }
        }
    }));
    assert.equal(pending.status, "warning");
    assert.equal(pending.result, "En curso");
    assert.equal(pending.passed, false);

    const failed = initialBitSummary(diagnosticsFixture({
        startup: {
            status: "error",
            ready: false,
            details: {
                completedAt: "2026-08-16T10:01:00Z",
                errors: ["EGM2008 corrupto"],
                readiness: { state: "blocked", blockers: [{ id: "gravity", message: "EGM2008 corrupto" }] },
                steps: [{ id: "complete", status: "error" }]
            }
        }
    }));
    assert.equal(failed.status, "error");
    assert.equal(failed.result, "Falló");
    assert.equal(failed.passed, false);
});

test("completed initial-BIT warnings produce one actionable non-blocking notice", () => {
    const diagnostics = diagnosticsFixture({
        startup: {
            status: "warning",
            ready: true,
            details: {
                completedAt: "2026-08-16T10:01:00Z",
                warnings: ["ERP IERS no cubre toda la operación"],
                readiness: {
                    state: "degraded-ready",
                    blockers: [],
                    degradations: [{ id: "erp", status: "warning", message: "ERP IERS no cubre toda la operación" }]
                },
                steps: [
                    { id: "erp", status: "warning", message: "ERP IERS no cubre toda la operación" },
                    { id: "complete", status: "warning", message: "Inicio terminado con aviso ERP" }
                ]
            }
        }
    });

    const summary = initialBitSummary(diagnostics);
    const notice = initialBitWarningNotice(diagnostics);

    assert.equal(summary.status, "warning");
    assert.equal(summary.passed, false);
    assert.deepEqual(initialBitWarningMessages(summary.startup), [
        "ERP IERS no cubre toda la operación",
        "Inicio terminado con aviso ERP"
    ]);
    assert.equal(notice?.projectReady, true, "the notice must not turn a degradable warning into a startup block");
    assert.equal(notice?.warnings.length, 2);
    assert.match(notice?.key || "", /^initial-bit-warning:2026-08-16T10:01:00Z:/);
});

test("initial-BIT notice stays silent for a clean result and does not compete with fatal readiness", () => {
    assert.equal(initialBitWarningNotice(diagnosticsFixture()), null);

    const failed = diagnosticsFixture({
        startup: {
            status: "error",
            ready: false,
            details: {
                completedAt: "2026-08-16T10:01:00Z",
                warnings: ["No debe mostrarse como aviso independiente"],
                errors: ["EGM2008 corrupto"],
                readiness: { state: "blocked", blockers: [{ id: "gravity", message: "EGM2008 corrupto" }] },
                steps: [{ id: "complete", status: "error", message: "EGM2008 corrupto" }]
            }
        }
    });
    assert.equal(initialBitWarningNotice(failed), null);
});
