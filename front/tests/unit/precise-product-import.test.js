import assert from "node:assert/strict";
import test from "node:test";

import {
    PRECISE_PRODUCT_MAX_FILE_BYTES,
    arrayBufferToBase64,
    buildPreciseProductImportPayload,
    isPreciseProductFileName,
    normalizePreciseProductImportOptions,
    validatePreciseProductFiles
} from "../../js/features/preciseProducts/import.js";

test("precise GNSS importer accepts SP3/SP3d/CLK names and their explicit archive suffixes", () => {
    for (const name of [
        "IGS0OPSFIN_20262220000_01D_05M_ORB.SP3.gz",
        "ESA0OPSFIN_20262220000_01D_05M_ORB.SP3.Z",
        "GFZ0MGXRAP_20262220000_01D_05M_ORB.SP3c.gz",
        "COD0MGXFIN_20262220000_01D_05M_ORB.SP3d",
        "IGS0OPSFIN_20262220000_01D_30S_CLK.CLK.zip",
        "IGS0OPSFIN_20262220000_01D_30S_CLK.CLK_30S.gz",
        "ESA0OPSFIN_20262220000_01D_05S_CLK.CLK_05S.Z",
        "provider-package.zip"
    ]) {
        assert.equal(isPreciseProductFileName(name), true, name);
    }
});

test("precise GNSS importer does not mistake arbitrary gzip or UNIX-compress files for products", () => {
    for (const name of ["catalog.json.gz", "earth-texture.Z", "readme.txt", "orbit.oem.gz"]) {
        assert.equal(isPreciseProductFileName(name), false, name);
    }
});

test("precise import options are constrained to the provider and class contract", () => {
    assert.deepEqual(normalizePreciseProductImportOptions({ providerHint: "ESA-NSO", productClass: "rapid" }), {
        provider_hint: "esa-nso",
        product_class: "rapid"
    });
    assert.deepEqual(normalizePreciseProductImportOptions({ provider_hint: "untrusted", product_class: "reprocessed" }), {
        provider_hint: "auto",
        product_class: "auto"
    });
});

test("precise import payload preserves binary bytes through chunked base64", async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x53, 0x50, 0x33]);
    assert.equal(arrayBufferToBase64(bytes), "AP9TUDM=");

    const file = {
        name: "IGS0OPSFIN_ORB.SP3.gz",
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer
    };
    assert.deepEqual(await buildPreciseProductImportPayload([file], {
        provider_hint: "cddis-igs",
        product_class: "final"
    }), {
        files: [{ name: file.name, content_base64: "AP9TUDM=" }],
        provider_hint: "cddis-igs",
        product_class: "final"
    });
});

test("precise import validation rejects an individual preflight size above the backend contract", () => {
    assert.throws(() => validatePreciseProductFiles([{
        name: "IGS0OPSFIN_ORB.SP3.gz",
        size: PRECISE_PRODUCT_MAX_FILE_BYTES + 1,
        arrayBuffer: async () => new ArrayBuffer(0)
    }]), /32 MiB/);
});
