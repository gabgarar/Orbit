import assert from "node:assert/strict";
import test from "node:test";

import {
    PRECISE_PRODUCT_IMPORT_ERRORS,
    PRECISE_PRODUCT_MAX_FILE_BYTES,
    arrayBufferToBase64,
    buildPreciseProductImportPayload,
    buildPreciseProductPreviewPayload,
    classifyPreciseProductFile,
    classifyPreciseProductSlotFile,
    isPreciseProductFileName,
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

test("precise import payload preserves binary bytes without manual provenance or ECI intent", async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x53, 0x50, 0x33]);
    assert.equal(arrayBufferToBase64(bytes), "AP9TUDM=");

    const file = {
        name: "IGS0OPSFIN_ORB.SP3.gz",
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer
    };
    assert.deepEqual(await buildPreciseProductImportPayload([file]), {
        sp3: { name: file.name, kind: "sp3", content_base64: "AP9TUDM=" }
    });
});

test("precise import sends only the GNSS satellites selected in the preview", async () => {
    const bytes = new Uint8Array([0x53, 0x50, 0x33]);
    const file = {
        name: "IGS0OPSFIN_ORB.SP3",
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer
    };

    const payload = await buildPreciseProductImportPayload([file], {
        selectedSatelliteIds: ["G01", "E12", " G01 ", ""]
    });

    assert.deepEqual(payload.selected_satellite_ids, ["G01", "E12"]);
    assert.equal(payload.sp3?.kind, "sp3");
});

test("GNSS preview uploads only the SP3 and never reads large companion products", async () => {
    const bytes = new Uint8Array([0x53, 0x50, 0x33]);
    let companionRead = false;
    const sp3 = {
        name: "COD0MGXFIN_20251310000_01D_05M_ORB.SP3",
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer
    };
    const clock = {
        name: "COD0MGXFIN_20251310000_01D_30S_CLK.CLK",
        // A real high-rate clock can be larger than the final import's old
        // request budget. It must not affect satellite discovery.
        size: 40 * 1024 * 1024,
        arrayBuffer: async () => {
            companionRead = true;
            throw new Error("The preview must not read CLK");
        }
    };
    const attitude = {
        name: "COD0MGXFIN_20251310000_01D_30S_ATT.OBX",
        size: 40 * 1024 * 1024,
        arrayBuffer: async () => {
            companionRead = true;
            throw new Error("The preview must not read ATT");
        }
    };

    const payload = await buildPreciseProductPreviewPayload([sp3, clock, attitude]);

    assert.deepEqual(Object.keys(payload), ["sp3"]);
    assert.equal(payload.sp3.name, sp3.name);
    assert.equal(companionRead, false);
});

test("GNSS slots identify ERP, product metadata, attitude and observable biases", () => {
    assert.equal(classifyPreciseProductFile("final.SP3.gz"), "sp3");
    assert.equal(classifyPreciseProductFile("final.CLK"), "clk");
    assert.equal(classifyPreciseProductFile("final.ERP.gz"), "erp");
    assert.equal(classifyPreciseProductFile("final.SUM"), "sum");
    assert.equal(classifyPreciseProductFile("final.SUM.gz"), "sum");
    assert.equal(classifyPreciseProductFile("final.ATT.OBX.gz"), "att");
    assert.equal(classifyPreciseProductFile("provider-attitude.OBX.gz"), "att");
    assert.equal(classifyPreciseProductFile("provider-attitude.ATT"), "att");
    assert.equal(classifyPreciseProductFile("final.OSB.BIA.gz"), "osb");
    assert.equal(classifyPreciseProductFile("provider-bias.BIA.gz"), "osb");
});

test("named GNSS slots accept documented and provider-practical suffixes", () => {
    assert.equal(classifyPreciseProductSlotFile("final.SP3.gz"), "sp3");
    assert.equal(classifyPreciseProductSlotFile("final.CLK"), "clk");
    assert.equal(classifyPreciseProductSlotFile("final.SUM.gz"), "sum");
    assert.equal(classifyPreciseProductSlotFile("final.ATT.OBX.gz"), "att");
    assert.equal(classifyPreciseProductSlotFile("provider.OBX"), "att");
    assert.equal(classifyPreciseProductSlotFile("provider.ATT.gz"), "att");
    assert.equal(classifyPreciseProductSlotFile("final.OSB.BIA.gz"), "osb");
    assert.equal(classifyPreciseProductSlotFile("provider.BIA"), "osb");
    assert.equal(classifyPreciseProductSlotFile("final.SP3c"), "");
    assert.equal(classifyPreciseProductSlotFile("final.CLK_30S.gz"), "");
    // The generic legacy path remains deliberately broader.
    assert.equal(classifyPreciseProductFile("final.SP3c"), "sp3");
    assert.equal(classifyPreciseProductFile("final.CLK_30S.gz"), "clk");
});

test("GNSS import requires SP3 while ERP remains an optional product member", () => {
    const sp3 = { name: "IGS_ORB.SP3", size: 5, arrayBuffer: async () => new ArrayBuffer(5) };
    const erp = { name: "IGS_ERP.ERP", size: 5, arrayBuffer: async () => new ArrayBuffer(5) };

    assert.throws(
        () => validatePreciseProductFiles([]),
        (error) => error?.message === PRECISE_PRODUCT_IMPORT_ERRORS.missingSp3
    );
    assert.doesNotThrow(() => validatePreciseProductFiles([sp3]));
    assert.doesNotThrow(() => validatePreciseProductFiles([sp3, erp]));
});

test("GNSS import sends named product slots without requesting an ECI conversion", async () => {
    const bytes = new Uint8Array([0x53, 0x50, 0x33]);
    const sp3 = { name: "IGS_ORB.SP3", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    const erp = { name: "IGS_ERP.ERP.gz", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    const payload = await buildPreciseProductImportPayload([sp3, erp]);

    assert.equal(payload.sp3.kind, "sp3");
    assert.equal(payload.erp.kind, "erp");
    assert.equal("files" in payload, false);
    assert.equal("require_eci" in payload, false);
    assert.equal("provider_hint" in payload, false);
    assert.equal("product_class" in payload, false);
});

test("GNSS import serializes every named companion slot in one request", async () => {
    const bytes = new Uint8Array([0x53, 0x50, 0x33]);
    const makeFile = (name) => ({
        name,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer
    });
    const files = [
        makeFile("COD0MGXFIN_20251310000_01D_05M_ORB.SP3.gz"),
        makeFile("COD0MGXFIN_20251310000_01D_30S_CLK.CLK.gz"),
        makeFile("COD0MGXFIN_20251310000_01D_12H_ERP.ERP.gz"),
        makeFile("COD0MGXFIN_20251310000_01D.SUM.gz"),
        makeFile("COD0MGXFIN_20251310000_01D_30S_ATT.OBX.gz"),
        makeFile("COD0MGXFIN_20251310000_01D_01D_OSB.BIA.gz")
    ];

    const payload = await buildPreciseProductImportPayload(files);
    for (const kind of ["sp3", "clk", "erp", "sum", "att", "osb"]) {
        assert.equal(payload[kind]?.kind, kind, kind);
    }
    assert.equal("files" in payload, false, "modern slot uploads are not duplicated into legacy files");
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
