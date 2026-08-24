import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    DIAGNOSTIC_COMPONENTS,
    DIAGNOSTIC_ENDPOINT_CANDIDATES,
    DIAGNOSTICS_LOCAL_STATE_EVENT,
    DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT,
    DIAGNOSTICS_STATE_EVENT,
    RUNTIME_HEALTH_ENDPOINT,
    fetchRuntimeHealth,
    fetchSystemDiagnostics,
    findDiagnosticComponent,
    normalizeDiagnosticComponent,
    normalizeDiagnosticStatus,
    normalizeRuntimeHealthPayload,
    normalizeSystemDiagnosticsPayload
} from "../../js/features/diagnostics/diagnosticsContract.js";

test("diagnostics normalizes canonical and compatibility component shapes without inventing values", () => {
    const diagnostics = normalizeSystemDiagnosticsPayload({
        status: "ok",
        updated_at: "2026-08-14T09:30:00Z",
        components: {
            eop_loader: {
                status: "passed",
                lastValidation: "2026-08-14T09:29:00Z",
                details: {
                    loaded: true,
                    source_url: "https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt",
                    coverage: { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" }
                }
            },
            "sp3-parser": { health: "warning", using_eop: false, eop_overlap: false },
            time_manager: { state: "healthy", message: "MTR clamped" },
            gravity_models: {
                status: "healthy",
                details: {
                    activeModel: "EGM2008",
                    models: {
                        EGM96: { status: "loaded", maxDegree: 360, maxOrder: 360 },
                        EGM2008: { status: "loaded", maxDegree: 2190, maxOrder: 2190 }
                    }
                }
            },
            startup_sequence: {
                state: "ready",
                details: { steps: [{ id: "config", status: "healthy" }] }
            }
        }
    });

    assert.equal(diagnostics.status, "healthy");
    assert.equal(diagnostics.updatedAt, "2026-08-14T09:30:00Z");
    assert.equal(findDiagnosticComponent(diagnostics, "erp")?.status, "healthy");
    assert.equal(findDiagnosticComponent(diagnostics, "erp")?.lastValidatedAt, "2026-08-14T09:29:00Z");
    assert.equal(findDiagnosticComponent(diagnostics, "erp")?.details.loaded, true);
    assert.equal(findDiagnosticComponent(diagnostics, "sp3")?.status, "warning");
    assert.equal(findDiagnosticComponent(diagnostics, "mtr")?.message, "MTR clamped");
    assert.equal(findDiagnosticComponent(diagnostics, "gravity")?.details.models.EGM2008.maxDegree, 2190);
    assert.equal(findDiagnosticComponent(diagnostics, "startup")?.status, "healthy");
    assert.equal(findDiagnosticComponent(diagnostics, "erp")?.details.coverage.start, "2026-08-01T00:00:00Z");
});

test("diagnostics status accepts only the three user-facing states", () => {
    assert.equal(normalizeDiagnosticStatus("passed"), "healthy");
    assert.equal(normalizeDiagnosticStatus("degraded"), "warning");
    assert.equal(normalizeDiagnosticStatus("failed"), "error");
    assert.equal(normalizeDiagnosticStatus("unexpected", "error"), "error");
    assert.equal(normalizeDiagnosticComponent({ id: "reference_frames", state: "ready" }).id, "frames");
    assert.equal(normalizeDiagnosticComponent({ id: "monitor", state: "ready" }).id, "monitor");
    assert.equal(DIAGNOSTIC_COMPONENTS.length, 11);
    assert.deepEqual(DIAGNOSTIC_ENDPOINT_CANDIDATES, ["/api/system/diagnostics", "/api/diagnostics"]);
});

test("diagnostics falls back to the compatibility endpoint without blocking the caller", async () => {
    const requests = [];
    const result = await fetchSystemDiagnostics(async (url) => {
        requests.push(url);
        if (url === "/api/system/diagnostics") return { ok: false, status: 404 };
        return {
            ok: true,
            status: 200,
            json: async () => ({ status: "healthy", erp: { status: "healthy", loaded: true } })
        };
    });

    assert.deepEqual(requests, ["/api/system/diagnostics", "/api/diagnostics"]);
    assert.equal(result.availability, "available");
    assert.equal(result.endpoint, "/api/diagnostics");
    assert.equal(findDiagnosticComponent(result.diagnostics, "erp")?.details.loaded, true);
});

test("an unavailable diagnostics endpoint is an explicit warning state, not a fabricated system result", async () => {
    const result = await fetchSystemDiagnostics(async () => {
        throw new Error("connection refused");
    });

    assert.equal(result.availability, "unavailable");
    assert.equal(result.diagnostics, null);
    assert.match(result.error, /connection refused/);
});

test("runtime health exposes gateway and Python liveness without claiming project readiness", async () => {
    const requests = [];
    const healthy = await fetchRuntimeHealth(async (url) => {
        requests.push(url);
        return {
            ok: true,
            status: 200,
            json: async () => ({ status: "ok", python_backend: "ok" })
        };
    });

    assert.deepEqual(requests, [RUNTIME_HEALTH_ENDPOINT]);
    assert.equal(healthy.availability, "available");
    assert.equal(healthy.gatewayStatus, "healthy");
    assert.equal(healthy.pythonBackendStatus, "healthy");
    assert.equal(healthy.status, "healthy");
    assert.equal("projectReady" in healthy, false);

    const starting = normalizeRuntimeHealthPayload(
        { status: "starting", python_backend: "unavailable" },
        { responseOk: false }
    );
    assert.equal(starting.gatewayStatus, "warning");
    assert.equal(starting.pythonBackendStatus, "warning");
    assert.equal(starting.status, "warning");
});

test("unreachable runtime health remains an explicit service error", async () => {
    const result = await fetchRuntimeHealth(async () => {
        throw new Error("connection refused");
    });

    assert.equal(result.availability, "unavailable");
    assert.equal(result.gatewayStatus, "error");
    assert.equal(result.status, "error");
    assert.match(result.error, /connection refused/);
});

test("Built-In Test is continuous, contextual, and preserves its cache event contract", () => {
    const panel = readFileSync(
        new URL("../../../react-ui/src/components/overlays/BuiltInTestPanel.jsx", import.meta.url),
        "utf8"
    );
    const hook = readFileSync(
        new URL("../../../react-ui/src/hooks/useSystemDiagnostics.js", import.meta.url),
        "utf8"
    );
    const toolbar = readFileSync(
        new URL("../../../react-ui/src/components/layout/TopToolbar.jsx", import.meta.url),
        "utf8"
    );
    const startupPanel = readFileSync(
        new URL("../../../react-ui/src/components/overlays/StartupStatusPanel.jsx", import.meta.url),
        "utf8"
    );
    const startupHook = readFileSync(
        new URL("../../../react-ui/src/hooks/useStartupStatus.js", import.meta.url),
        "utf8"
    );
    const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
    const contract = readFileSync(
        new URL("../../js/features/diagnostics/diagnosticsContract.js", import.meta.url),
        "utf8"
    );
    const dashboard = readFileSync(
        new URL("../../js/features/diagnostics/bitDashboardPresentation.js", import.meta.url),
        "utf8"
    );

    assert.match(toolbar, /topBuiltInTestBtn/);
    assert.match(toolbar, /Built-In Test/);
    assert.match(toolbar, /toolbar-diagnostics-status/);
    assert.doesNotMatch(toolbar, /<span>Built-In Test<\/span>/);
    assert.match(panel, /role="dialog"/);
    assert.match(panel, /aria-modal="true"/);
    assert.match(panel, /buildBitDashboard/);
    assert.match(panel, /PBIT de inicio/);
    assert.match(dashboard, /Servicios de Orbit/);
    assert.match(dashboard, /Tiempo y referencia/);
    assert.match(dashboard, /Validaciones del runtime/);
    assert.match(dashboard, /Gateway web/);
    assert.match(dashboard, /Backend Python/);
    assert.match(panel, /ERP aplicado/);
    assert.match(panel, /Ajuste de timeline/);
    assert.doesNotMatch(panel, /quality\.yml/);
    assert.doesNotMatch(panel, /docs-pages\.yml/);
    assert.match(panel, /lastValidatedAt/);
    assert.match(contract, /Gravity models \(EGM96 \/ EGM2008\)/);
    assert.match(panel, /EGM96/);
    assert.match(panel, /EGM2008/);
    assert.match(contract, /Startup sequence/);
    assert.match(startupPanel, /Estado de arranque/);
    assert.match(startupPanel, /aria-live="polite"/);
    assert.doesNotMatch(startupPanel, /aria-modal/);
    assert.match(startupHook, /STARTUP_STATUS_EVENT/);
    assert.match(startupHook, /startupStatusFromDiagnosticComponent/);
    assert.doesNotMatch(app, /StartupStatusPanel/);
    assert.match(app, /getStartupProjectReadiness\(startup\)\.ready/);
    assert.match(app, /pollIntervalMs: 2_500/);
    assert.doesNotMatch(app, /stopWhen:/);
    assert.match(hook, /DIAGNOSTICS_STATE_EVENT/);
    assert.match(hook, /DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT/);
    assert.match(hook, /fetchRuntimeHealth/);
    assert.match(contract, /RUNTIME_HEALTH_ENDPOINT/);
    assert.match(hook, /setInterval/);
    assert.match(runtime, /DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT/);
    assert.match(runtime, /publishDiagnosticsLocalState/);
    assert.equal(DIAGNOSTICS_STATE_EVENT, "orbit:diagnostics-state");
    assert.equal(DIAGNOSTICS_LOCAL_STATE_EVENT, "orbit:diagnostics-local-state");
    assert.equal(DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT, "orbit:diagnostics-local-state-request");
});
