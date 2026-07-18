import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogImportService } from "../../src/catalog/import-service.js";

const ommXml = `
<ndm><omm><body><segment>
  <metadata><OBJECT_NAME>TEST OMM</OBJECT_NAME></metadata>
  <data><tleParameters>
    <TLE_LINE1>1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996</TLE_LINE1>
    <TLE_LINE2>2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395</TLE_LINE2>
  </tleParameters></data>
</segment></body></omm></ndm>`;

const validTle = {
    line1: "1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996",
    line2: "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395"
};

const tleContent = (name) => `${name}\n${validTle.line1}\n${validTle.line2}`;

test("catalog import rejects blank content before accessing persistence", async () => {
    const importer = createCatalogImportService({
        catalog: { get: async () => { throw new Error("catalog should not be read"); } },
        serialize: {},
        reloadPython: async () => { throw new Error("backend should not reload"); }
    });
    const result = await importer.importContent({ content: "   " });
    assert.deepEqual(result, { ok: false, status: 400, error: "Contenido de fichero vacio." });
});

test("catalog import treats .omm XML as an OMM catalog instead of OEM", async () => {
    let savedEntries;
    let reloads = 0;
    const importer = createCatalogImportService({
        catalog: {
            get: async () => ({ entries: [] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        serialize: {},
        reloadPython: async () => { reloads += 1; }
    });

    const result = await importer.importContent({ fileName: "sample.omm", content: ommXml, merge: false });

    assert.equal(result.ok, true);
    assert.equal(result.format, "OMM_XML");
    assert.equal(result.imported, 1);
    assert.equal(savedEntries[0].sourceFormat, "OMM");
    assert.equal(savedEntries[0].sourceOrigin, "CUSTOM");
    assert.equal(reloads, 1);
});

test("a custom import replaces a catalog entry with the same NORAD ID", async () => {
    let savedEntries;
    const importer = createCatalogImportService({
        catalog: {
            get: async () => ({ entries: [{ ...validTle, name: "REMOTE CATALOG", sourceOrigin: "CATALOG" }] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        serialize: {},
        reloadPython: async () => {}
    });

    await importer.importContent({ fileName: "custom.tle", content: tleContent("IMPORTED CUSTOM") });

    assert.equal(savedEntries.length, 1);
    assert.equal(savedEntries[0].name, "IMPORTED CUSTOM");
    assert.equal(savedEntries[0].sourceOrigin, "CUSTOM");
});

test("an existing custom entry remains authoritative during a merged import", async () => {
    let savedEntries;
    const importer = createCatalogImportService({
        catalog: {
            get: async () => ({ entries: [{ ...validTle, name: "EXISTING CUSTOM", sourceOrigin: "CUSTOM" }] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        serialize: {},
        reloadPython: async () => {}
    });

    await importer.importContent({ fileName: "custom.tle", content: tleContent("NEW CUSTOM") });

    assert.equal(savedEntries.length, 1);
    assert.equal(savedEntries[0].name, "EXISTING CUSTOM");
    assert.equal(savedEntries[0].sourceOrigin, "CUSTOM");
});

test("a replacement import does not read the existing catalog", async () => {
    let savedEntries;
    const importer = createCatalogImportService({
        catalog: {
            get: async () => { throw new Error("replacement import should not read the catalog"); },
            replace: async (entries) => { savedEntries = entries; }
        },
        serialize: {},
        reloadPython: async () => {}
    });

    const result = await importer.importContent({ fileName: "custom.tle", content: tleContent("REPLACEMENT"), merge: false });

    assert.equal(result.merge, false);
    assert.equal(savedEntries.length, 1);
    assert.equal(savedEntries[0].name, "REPLACEMENT");
});

test("catalog import reports a persisted-but-not-reloaded backend", async () => {
    let savedEntries;
    const importer = createCatalogImportService({
        catalog: {
            replace: async (entries) => { savedEntries = entries; }
        },
        serialize: {},
        reloadPython: async () => false
    });

    const result = await importer.importContent({ fileName: "custom.tle", content: tleContent("RELOAD PENDING"), merge: false });

    assert.equal(savedEntries.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.persisted, true);
    assert.match(result.error, /backend de propagacion no pudo recargarse/);
});
