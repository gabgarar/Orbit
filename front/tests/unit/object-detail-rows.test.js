import assert from "node:assert/strict";
import test from "node:test";

import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

test("overview absorbs info rows and exposes the live simulation interval", () => {
    const details = buildObjectDetails({
        id: "SAT-1",
        sourceFormat: "OEM",
        visible: true,
        telemetry: { id: "SAT-1", geo: {} },
        timeRange: {
            startDate: "2026-07-19T10:00:00.000Z",
            endDate: "2026-07-19T16:00:00.000Z",
            label: "6 h hacia futuro"
        }
    });

    assert.equal("info" in details.rows, false);
    assert.equal(details.rows.overview.find(([label]) => label === "Fecha inicio")?.[1], "2026-07-19 10:00 UTC");
    assert.equal(details.rows.overview.find(([label]) => label === "Fecha fin")?.[1], "2026-07-19 16:00 UTC");
    assert.equal(details.rows.overview.find(([label]) => label === "Rango OEM")?.[1], "6 h hacia futuro");
});

test("overview falls back to the simulation-range duration label", () => {
    const details = buildObjectDetails({
        id: "SAT-2",
        telemetry: { id: "SAT-2", geo: {} },
        timeRange: { mode: "range", oemRangeHours: 24 }
    });

    assert.equal(details.rows.overview.find(([label]) => label === "Rango OEM")?.[1], "24 h (inicio → fin)");
});

test("overview stays administrative and uses only available catalogue metadata", () => {
    const details = buildObjectDetails({
        id: "SENTINEL-TEST",
        sourceFormat: "TLE",
        active: true,
        visible: true,
        referenceTimeMs: Date.parse("2026-07-19T06:00:00.000Z"),
        telemetry: {
            id: "SENTINEL-TEST",
            geo: { altitude_m: 511000 },
            timestamp_ms: Date.parse("2026-07-19T06:00:00.000Z")
        },
        catalogMeta: {
            name: "Sentinel Test",
            missionType: "Earth observation",
            operatorLabel: "ESA",
            country: "Spain",
            sourceFormat: "TLE",
            tleSource: "Celestrak",
            objectId: "2026-001A",
            launchDate: "2026-01-10T00:00:00.000Z",
            launchVehicle: "Vega-C",
            launchSite: "CSG",
            updatedAt: "2026-07-18T12:00:00.000Z"
        },
        tleSummary: { epoch: "26197.25000000" },
        orbitInfo: { label: "LEO", altitudeKm: 512.345, recommendedMaxDays: 3 }
    });
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(details.title, "Sentinel Test");
    assert.equal(overview["Nombre"], "Sentinel Test");
    assert.equal(overview["Misión"], "Earth observation");
    assert.equal(overview["Operador / agencia"], "ESA");
    assert.equal(overview["Fuente TLE"], "Celestrak");
    assert.equal(overview["Estado TLE"], "Vigente");
    assert.equal(overview["Edad TLE"], "72.0 h");
    assert.equal(overview["Fecha de lanzamiento"], "2026-01-10 00:00 UTC");
    assert.equal(overview["Última actualización"], "2026-07-18 12:00 UTC");
    assert.equal(overview["Inclination"], undefined);
    assert.equal(overview["RAAN"], undefined);
    assert.equal(overview["Velocity"], undefined);
});

test("overview marks an outdated TLE without fabricating missing metadata", () => {
    const details = buildObjectDetails({
        id: "SAT-OLD",
        sourceFormat: "TLE",
        referenceTimeMs: Date.parse("2026-07-25T06:00:00.000Z"),
        telemetry: { id: "SAT-OLD", geo: {} },
        tleSummary: { epoch: "26197.25000000" },
        orbitInfo: { recommendedMaxDays: 3 }
    });
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(overview["Estado TLE"], "Caducado");
    assert.equal(overview["Operador / agencia"], "-");
    assert.equal(overview["Fecha de lanzamiento"], "-");
});

test("overview uses the TLE international designator when the catalogue omits Object ID", () => {
    const details = buildObjectDetails({
        id: "SAT-LAYER-ID",
        sourceFormat: "TLE",
        telemetry: { id: "SAT-LAYER-ID", geo: {} },
        catalogMeta: { name: "Satellite" },
        tleSummary: { internationalDesignator: "26001A" }
    });

    assert.equal(Object.fromEntries(details.rows.overview)["Object ID"], "26001A");
});

test("overview rejects an impossible non-leap TLE day instead of rolling it into the next year", () => {
    const details = buildObjectDetails({
        id: "SAT-INVALID-EPOCH",
        sourceFormat: "TLE",
        referenceTimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
        telemetry: { id: "SAT-INVALID-EPOCH", geo: {} },
        tleSummary: { epoch: "25366.50000000" },
        orbitInfo: { recommendedMaxDays: 3 }
    });
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(overview["Edad TLE"], "-");
    assert.equal(overview["Estado TLE"], "-");
});
