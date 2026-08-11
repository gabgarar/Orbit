import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizePreciseProductPreview,
    normalizeSelectedPreciseProductSatelliteIds
} from "../../js/features/preciseProducts/preview.js";

test("GNSS product preview normalizes satellite rows without exposing runtime identifiers", () => {
    const preview = normalizePreciseProductPreview({
        ok: true,
        preview: {
            product: {
                name: "IGS final orbit",
                provider: "IGS",
                coverage: {
                    start_time: "2026-08-10T00:00:00Z",
                    end_time: "2026-08-10T23:59:30Z",
                    time_scale: "UTC"
                },
                sample_cadence_seconds: 30
            },
            satellites: [
                {
                    satellite_id: "G01",
                    display_name: "GPS BIIR-2",
                    constellation: "GPS",
                    coverage: {
                        start_time: "2026-08-10T00:00:00Z",
                        end_time: "2026-08-10T23:59:30Z"
                    },
                    sample_count: 2880,
                    sample_cadence_seconds: 30,
                    runtime_id: "do-not-show-this"
                },
                {
                    gnss_id: "E12",
                    name: "Galileo 12",
                    sample_count: 2880
                },
                {
                    satellite_id: "G01",
                    display_name: "Duplicate GPS row"
                },
                {
                    object_id: "runtime-only-id"
                }
            ]
        }
    });

    assert.equal(preview.product?.name, "IGS final orbit");
    assert.equal(preview.satellites.length, 2);
    assert.deepEqual(preview.satellites.map((satellite) => satellite.id), ["G01", "E12"]);
    assert.equal(preview.satellites[0].name, "GPS BIIR-2");
    assert.equal(preview.satellites[0].coverageStart, "2026-08-10T00:00:00Z");
    assert.equal(preview.satellites[0].coverageEnd, "2026-08-10T23:59:30Z");
    assert.equal(preview.satellites[0].sampleCount, 2880);
    assert.equal(preview.satellites[0].cadenceSeconds, 30);
    assert.equal(preview.satellites[1].constellation, "Galileo");
    assert.equal(preview.satellites[1].coverageStart, "2026-08-10T00:00:00Z");
    assert.equal(preview.satellites[1].cadenceSeconds, 30);
});

test("GNSS preview selection identifiers are trimmed and de-duplicated before import", () => {
    assert.deepEqual(
        normalizeSelectedPreciseProductSatelliteIds(["G01", " E12 ", "G01", "", null, undefined]),
        ["G01", "E12"]
    );
});
