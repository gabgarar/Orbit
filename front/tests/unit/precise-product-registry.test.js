import assert from "node:assert/strict";
import test from "node:test";

import {
    getCatalogEntryMeta,
    getSatelliteIds,
    preciseProductSatelliteEntriesFromPayload,
    registerPreciseProductSatelliteEntries
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
            time_system: "GPS",
            start_time: "2026-08-10T00:00:00Z",
            end_time: "2026-08-10T23:55:00Z",
            rendering: {
                available: false,
                source_frame: "IGS14",
                reason: "IGS14 requires a registered terrestrial-realization transform."
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

    registerPreciseProductSatelliteEntries(entries);
    const metadata = getCatalogEntryMeta(id);
    assert.equal(metadata.sourceOrigin, "PRECISE_PRODUCT");
    assert.equal(metadata.inputMetadata.provider, "cddis-igs");
    assert.equal(metadata.inputMetadata.product_name, "IGS final 2026-08-10");
    assert.equal(metadata.inputMetadata.file_name, "IGS0OPSFIN_20262230000_01D_05M_ORB.SP3.gz");
    assert.equal(metadata.inputMetadata.rendering.available, false);
});
