import assert from "node:assert/strict";
import test from "node:test";

import {
    BIT_AUDIT_SCHEMA,
    bitAuditFileName,
    bitAuditRows,
    buildBitAuditSnapshot,
    serializeBitAuditCsv
} from "../../js/features/diagnostics/bitAudit.js";

function dashboardFixture() {
    return {
        status: "warning",
        pbit: {
            status: "warning",
            result: "Completado con avisos",
            message: "ERP cubierto parcialmente",
            startup: {
                startedAt: "2026-08-26T10:00:00Z",
                completedAt: "2026-08-26T10:01:00Z",
                readiness: { ready: true, state: "degraded-ready", message: "Puede continuar con aviso" },
                warnings: ["ERP cubierto parcialmente"],
                errors: [],
                steps: [
                    { id: "gravity", label: "Validar gravedad", status: "healthy", timestamp: "2026-08-26T10:00:15Z" },
                    { id: "erp", label: "Validar ERP", status: "warning", timestamp: "2026-08-26T10:00:45Z", message: "Predicción activa" }
                ]
            }
        }
    };
}

test("BIT audit combines the current PBIT ledger with compact project propagation metadata", () => {
    const audit = buildBitAuditSnapshot({
        dashboard: dashboardFixture(),
        availability: "available",
        endpoint: "/api/system/diagnostics",
        checkedAt: "2026-08-26T10:02:00Z",
        exportedAt: "2026-08-26T10:03:00Z",
        propagationHistory: [{
            id: "propagation:1",
            status: "completed",
            target: { id: "G01", name: "G01" },
            source: "SP3",
            propagator: "tabular",
            range: { startTime: "2026-08-26T00:00:00Z", endTime: "2026-08-26T01:00:00Z" },
            sampling: { effectiveIntervalSeconds: 60, sampleCount: 61 },
            result: { sampleCount: 61, outputFrame: "ITRF2020" },
            message: "Serie completada",
            updatedAt: "2026-08-26T10:02:30Z",
            // This must never cross the audit boundary.
            samples: [{ epoch: "secret raw sample" }]
        }]
    });

    assert.equal(audit.schema, BIT_AUDIT_SCHEMA);
    assert.equal(audit.system.status, "warning");
    assert.equal(audit.pbit.readiness.ready, true);
    assert.equal(audit.pbit.steps.length, 2);
    assert.equal(audit.propagationHistory.length, 1);
    assert.equal(Object.hasOwn(audit.propagationHistory[0], "samples"), false);

    const rows = bitAuditRows(audit);
    assert.deepEqual(rows.map((row) => row.kind), ["PBIT", "PBIT", "PBIT", "PROPAGACIÓN"]);
    assert.equal(rows.at(-1)?.sampling, 60);
    assert.equal(rows.at(-1)?.sampleCount, 61);
});

test("BIT audit CSV preserves values safely and the download names are deterministic", () => {
    const audit = buildBitAuditSnapshot({
        dashboard: dashboardFixture(),
        exportedAt: "2026-08-26T10:03:00Z",
        propagationHistory: [{
            id: "quoted",
            status: "failed",
            target: { name: "A \"quoted\" orbit" },
            error: "No route, retry later",
            updatedAt: "2026-08-26T10:04:00Z"
        }]
    });
    const csv = serializeBitAuditCsv(audit);

    assert.match(csv, /^\uFEFF"kind","status","timestamp_utc"/);
    assert.match(csv, /"A ""quoted"" orbit"/);
    assert.match(csv, /"failed"/);
    assert.equal(bitAuditFileName("csv", "2026-08-26T10:03:00Z"), "orbit-bit-audit-2026-08-26T10-03-00-000Z.csv");
    assert.equal(bitAuditFileName("unexpected", "2026-08-26T10:03:00Z"), "orbit-bit-audit-2026-08-26T10-03-00-000Z.json");
});
