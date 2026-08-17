import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSystemDiagnosticsPayload } from "../../js/features/diagnostics/diagnosticsContract.js";
import {
    continuousBitStatus,
    initialBitSummary,
    visibleBitComponents
} from "../../js/features/diagnostics/bitPresentation.js";

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
