import assert from "node:assert/strict";
import test from "node:test";

import {
    getCatalogEntryMeta,
    getLoadedPreciseProductTimeRanges,
    getObjectIntrinsicTimeRange,
    getObjectIntrinsicTimeRangeUnion,
    getObjectMtrStatus,
    getSatelliteDisplayName,
    getSatelliteTelemetry,
    getSatelliteIds,
    preciseProductSatelliteEntriesFromPayload,
    registerPreciseProductSatelliteEntries,
    setSimulationTimelineProvider
} from "../../js/satellites.js";

test("precise product entries become layer-compatible SP3 catalogue identities", () => {
    const id = "precise:igs-final-demo:G01";
    const registered = registerPreciseProductSatelliteEntries([{
        id,
        display_name: "GPS G01",
        satellite_id: "G01",
        product_id: "igs-final-demo",
        sourceFormat: "SP3",
        sp3: {
            provider: "NASA CDDIS / IGS",
            product_class: "final",
            file_name: "IGS0OPSFIN_20262220000_01D_05M_ORB.SP3.gz",
            clock_file: "IGS0OPSFIN_20262220000_01D_30S_CLK.CLK.gz",
            reference_frame: "ITRF",
            time_system: "GPS"
        }
    }]);

    assert.deepEqual(registered, [id]);
    assert.equal(getSatelliteIds().includes(id), true);
    const metadata = getCatalogEntryMeta(id);
    assert.equal(metadata.sourceFormat, "SP3");
    assert.equal(metadata.sourceOrigin, "PRECISE_PRODUCT");
    assert.equal(metadata.name, "GPS G01");
    assert.equal(metadata.inputMetadata.provider, "NASA CDDIS / IGS");
    assert.equal(metadata.inputMetadata.product_class, "final");
    assert.equal(metadata.inputMetadata.satellite_id, "G01");
    assert.equal(
        getSatelliteDisplayName(id),
        "GPS G01",
        "Layers must not fall back to the opaque precise runtime identifier"
    );
});

test("precise product response folds product provenance into every SP3 layer", () => {
    const id = "precise:igs-final-response:G02";
    const entries = preciseProductSatelliteEntriesFromPayload({
        product: {
            id: "igs-final-response",
            name: "IGS final 2026-08-10",
            provider: "cddis-igs",
            product_class: "final",
            orbit_file: "IGS0OPSFIN_20262230000_01D_05M_ORB.SP3.gz",
            clock_file: "IGS0OPSFIN_20262230000_01D_30S_CLK.CLK.gz",
            frame: "ITRF",
            native_reference_frame: "IGC20",
            native_frame: { name: "IGS", realization: "IGC20", center: "EARTH", time_scale: "UTC" },
            time_system: "GPS",
            start_time: "2026-08-10T00:00:00Z",
            end_time: "2026-08-10T23:55:00Z",
            rendering: {
                available: false,
                source_frame: "IGS14",
                reason: "IGS14 requires a registered terrestrial-realization transform."
            },
            renderer_reference: {
                status: "unavailable",
                available: false,
                reference_frame: "ITRF",
                display_label: "IGC20",
                reason: "IGC20 requires a registered terrestrial-realization transform."
            }
        },
        satellites: [{
            id,
            display_name: "G02",
            satellite_id: "G02",
            product_id: "igs-final-response",
            catalogMeta: { sourceFormat: "SP3", provider_id: "cddis-igs", product_class: "final" },
            sp3: { sample_count: 288, reference_frame: "ITRF", time_scale: "GPS" }
        }]
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].sp3.file_name, "IGS0OPSFIN_20262230000_01D_05M_ORB.SP3.gz");
    assert.equal(entries[0].sp3.clock_file, "IGS0OPSFIN_20262230000_01D_30S_CLK.CLK.gz");
    assert.equal(entries[0].sp3.start_time, "2026-08-10T00:00:00Z");
    assert.equal(entries[0].sp3.rendering.available, false);
    assert.equal(entries[0].sp3.native_reference_frame, "IGC20");
    assert.equal(entries[0].sp3.native_frame.realization, "IGC20");
    assert.equal(entries[0].sp3.renderer_reference.status, "unavailable");

    registerPreciseProductSatelliteEntries(entries);
    const metadata = getCatalogEntryMeta(id);
    assert.equal(metadata.sourceOrigin, "PRECISE_PRODUCT");
    assert.equal(metadata.inputMetadata.provider, "cddis-igs");
    assert.equal(metadata.inputMetadata.product_name, "IGS final 2026-08-10");
    assert.equal(metadata.inputMetadata.file_name, "IGS0OPSFIN_20262230000_01D_05M_ORB.SP3.gz");
    assert.equal(metadata.inputMetadata.rendering.available, false);
    assert.equal(metadata.inputMetadata.native_reference_frame, "IGC20");
    assert.equal(metadata.inputMetadata.renderer_reference.display_label, "IGC20");
});

test("native-only precise products expose their native frame to every UI consumer", () => {
    const id = "precise:igc20-native:G03";
    registerPreciseProductSatelliteEntries([{
        id,
        name: "G03",
        sourceFormat: "SP3",
        satellite_id: "G03",
        product_id: "igc20-native",
        sp3: {
            start_time: "2000-01-01T00:00:00Z",
            end_time: "2100-01-01T00:00:00Z",
            native_reference_frame: "IGC20",
            reference_frame: "ITRF",
            renderer_reference: {
                status: "unavailable",
                available: false,
                reference_frame: "ITRF",
                reason: "No EOP realization operation is configured."
            }
        }
    }]);

    const telemetry = getSatelliteTelemetry(id);
    assert.equal(telemetry.position_frame, "IGC20");
    assert.equal(telemetry.position_frame_display, "Marco terrestre aproximado (sin ERP)");
    assert.equal(telemetry.rendering_available, false);
    assert.equal(telemetry.runtime_state, "UNAVAILABLE");
});

test("an SP3 member retains its own finite coverage and reports out-of-range without sampling", () => {
    const id = "precise:coverage-contract:G04";
    registerPreciseProductSatelliteEntries([{
        id,
        name: "G04",
        sourceFormat: "SP3",
        satellite_id: "G04",
        product_id: "coverage-contract",
        sp3: {
            start_time: "2026-08-10T00:00:00Z",
            end_time: "2026-08-10T00:10:00Z",
            reference_frame: "ITRF"
        }
    }]);

    const range = getObjectIntrinsicTimeRange(id);
    assert.equal(range.startTime, "2026-08-10T00:00:00.000Z");
    assert.equal(range.endTime, "2026-08-10T00:10:00.000Z");
    assert.equal(Object.isFrozen(range), false, "callers receive a detached range copy");
    assert.deepEqual(getObjectMtrStatus(id, "2026-08-10T00:05:00Z"), {
        status: "active",
        active: true,
        hasIntrinsicTimeRange: true,
        range,
        checkedAtMs: Date.parse("2026-08-10T00:05:00Z"),
        reason: null
    });

    const outside = getObjectMtrStatus(id, "2026-08-10T00:10:00.001Z");
    assert.equal(outside.status, "out_of_range");
    assert.equal(outside.active, false);
    assert.equal(outside.reason, "outside-intrinsic-time-range");
    assert.equal(getLoadedPreciseProductTimeRanges({ activeOnly: false }).some((entry) => entry.id === id), true);

    setSimulationTimelineProvider(() => ({
        mode: "range",
        date: new Date("2026-08-10T00:10:00.001Z"),
        rangeStart: new Date("2026-08-09T00:00:00Z"),
        rangeEnd: new Date("2026-08-11T00:00:00Z")
    }));
    try {
        const telemetry = getSatelliteTelemetry(id);
        assert.equal(telemetry.runtime_state, "OUT_OF_RANGE");
        assert.equal(telemetry.position, null);
        assert.equal(telemetry.velocity_ecef_m_s, null);
        assert.equal(telemetry.out_of_range_message, "Este objeto no tiene datos para la época actual.");
    } finally {
        setSimulationTimelineProvider(null);
    }
});

test("finite-object range unions are safe for MTR activation approval", () => {
    const firstId = "precise:coverage-union:G20";
    const secondId = "precise:coverage-union:G21";
    const missingId = "precise:coverage-union:G22";
    registerPreciseProductSatelliteEntries([
        {
            id: firstId,
            name: "G20",
            sourceFormat: "SP3",
            satellite_id: "G20",
            product_id: "coverage-union",
            sp3: {
                start_time: "2026-08-10T00:00:00Z",
                end_time: "2026-08-10T01:00:00Z"
            }
        },
        {
            id: secondId,
            name: "G21",
            sourceFormat: "SP3",
            satellite_id: "G21",
            product_id: "coverage-union",
            sp3: {
                start_time: "2026-08-10T00:30:00Z",
                end_time: "2026-08-10T02:00:00Z"
            }
        },
        {
            id: missingId,
            name: "G22",
            sourceFormat: "SP3",
            satellite_id: "G22",
            product_id: "coverage-union",
            sp3: { reference_frame: "ITRF" }
        }
    ]);

    const union = getObjectIntrinsicTimeRangeUnion([
        firstId,
        secondId,
        "catalogue-tle-control",
        firstId
    ]);
    assert.equal(union.valid, true);
    assert.deepEqual(union.finiteIds, [firstId, secondId]);
    assert.deepEqual(union.missingIds, []);
    assert.equal(union.hasFiniteCoverage, true);
    assert.equal(union.range.startTime, "2026-08-10T00:00:00.000Z");
    assert.equal(union.range.endTime, "2026-08-10T02:00:00.000Z");
    assert.deepEqual(union.ranges.map((range) => range.id), [firstId, secondId]);

    const blocked = getObjectIntrinsicTimeRangeUnion([firstId, missingId]);
    assert.equal(blocked.valid, false);
    assert.equal(blocked.reason, "intrinsic-time-range-unavailable");
    assert.deepEqual(blocked.missingIds, [missingId]);
    assert.equal(blocked.range, null, "an approval caller cannot accidentally expand from partial coverage");
});
