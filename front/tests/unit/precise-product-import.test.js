import assert from "node:assert/strict";
import test from "node:test";

import {
    PRECISE_PRODUCT_IMPORT_ERRORS,
    PRECISE_PRODUCT_MAX_FILE_BYTES,
    arrayBufferToBase64,
    buildPreciseProductImportPayload,
    classifyPreciseProductFile,
    classifyPreciseProductSlotFile,
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
        "IGS0OPSFIN_20262220000_01D_ERP.ERP.gz",
        "IGS0OPSFIN_20262220000_01D.SUM",
        "IGS0OPSFIN_20262220000_01D.ATT.OBX.gz",
        "IGS0OPSFIN_20262220000_01D.OSB.BIA",
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
        product_class: "rapid",
        require_eci: false
    });
    assert.deepEqual(normalizePreciseProductImportOptions({ provider_hint: "untrusted", product_class: "reprocessed" }), {
        provider_hint: "auto",
        product_class: "auto",
        require_eci: false
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
        files: [{ name: file.name, kind: "sp3", content_base64: "AP9TUDM=" }],
        sp3: { name: file.name, kind: "sp3", content_base64: "AP9TUDM=" },
        provider_hint: "cddis-igs",
        product_class: "final",
        require_eci: false
    });
});

test("GNSS slots identify ERP, product metadata, attitude and observable biases", () => {
    assert.equal(classifyPreciseProductFile("final.SP3.gz"), "sp3");
    assert.equal(classifyPreciseProductFile("final.CLK"), "clk");
    assert.equal(classifyPreciseProductFile("final.ERP.gz"), "erp");
    assert.equal(classifyPreciseProductFile("final.SUM"), "sum");
    assert.equal(classifyPreciseProductFile("final.ATT.OBX.gz"), "att");
    assert.equal(classifyPreciseProductFile("final.OSB.BIA.gz"), "osb");
});

test("named GNSS slots keep their documented canonical suffix contract", () => {
    assert.equal(classifyPreciseProductSlotFile("final.SP3.gz"), "sp3");
    assert.equal(classifyPreciseProductSlotFile("final.CLK"), "clk");
    assert.equal(classifyPreciseProductSlotFile("final.SP3c"), "");
    assert.equal(classifyPreciseProductSlotFile("final.CLK_30S.gz"), "");
    // The generic legacy path remains deliberately broader.
    assert.equal(classifyPreciseProductFile("final.SP3c"), "sp3");
    assert.equal(classifyPreciseProductFile("final.CLK_30S.gz"), "clk");
});

test("GNSS import requires SP3 and requires ERP only when ECI is requested", () => {
    const sp3 = { name: "IGS_ORB.SP3", size: 5, arrayBuffer: async () => new ArrayBuffer(5) };
    const erp = { name: "IGS_ERP.ERP", size: 5, arrayBuffer: async () => new ArrayBuffer(5) };

    assert.throws(
        () => validatePreciseProductFiles([]),
        (error) => error?.message === PRECISE_PRODUCT_IMPORT_ERRORS.missingSp3
    );
    assert.throws(
        () => validatePreciseProductFiles([sp3], { require_eci: true }),
        (error) => error?.message === PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci
    );
    assert.doesNotThrow(() => validatePreciseProductFiles([sp3, erp], { requireEci: true }));
});

test("GNSS import sends named product slots and an explicit ECI intent", async () => {
    const bytes = new Uint8Array([0x53, 0x50, 0x33]);
    const sp3 = { name: "IGS_ORB.SP3", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    const erp = { name: "IGS_ERP.ERP.gz", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    const payload = await buildPreciseProductImportPayload([sp3, erp], { requireEci: true });

    assert.equal(payload.require_eci, true);
    assert.equal(payload.sp3.kind, "sp3");
    assert.equal(payload.erp.kind, "erp");
    assert.deepEqual(payload.files.map((file) => file.kind), ["sp3", "erp"]);
});

test("legacy SP3c/CLK files remain in the generic transport rather than violating named slots", async () => {
    const bytes = new Uint8Array([0x53, 0x50, 0x33]);
    const sp3c = { name: "legacy.SP3c", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    const clk = { name: "legacy.CLK_30S.gz", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    const payload = await buildPreciseProductImportPayload([sp3c, clk]);

    assert.deepEqual(payload.files.map((file) => file.kind), ["sp3", "clk"]);
    assert.equal(payload.sp3, undefined);
    assert.equal(payload.clk, undefined);
});

test("precise import validation rejects an individual preflight size above the backend contract", () => {
    assert.throws(() => validatePreciseProductFiles([{
        name: "IGS0OPSFIN_ORB.SP3.gz",
        size: PRECISE_PRODUCT_MAX_FILE_BYTES + 1,
        arrayBuffer: async () => new ArrayBuffer(0)
    }]), /32 MiB/);
});
