import test from "node:test";
import assert from "node:assert/strict";
import { formatCatalogEntryToOcm, formatCatalogEntryToOmmJson, formatCatalogEntryToOmmXml } from "../../src/catalog/exporters.js";
import { getExportNoradId, getQueryableNoradId } from "../../src/catalog/identity.js";
import { withCatalogMetadata } from "../../src/catalog/metadata.js";
import { parseOmmXmlCatalog } from "../../src/catalog/parsers.js";

const tleEntry = {
    name: "TEST SATELLITE",
    line1: "1 12345U",
    line2: "2 12345",
    noradId: "external"
};

test("catalog queries derive numeric NORAD IDs from the TLE while exports preserve explicit IDs", () => {
    assert.equal(getQueryableNoradId(tleEntry), "12345");
    assert.equal(getExportNoradId(tleEntry), "external");
    assert.equal(JSON.parse(formatCatalogEntryToOmmJson(tleEntry)).NORAD_CAT_ID, "external");
    assert.equal(JSON.parse(formatCatalogEntryToOcm(tleEntry)).object.norad_id, "external");
});

test("catalog identity falls back to the TLE field and keeps the query validation strict", () => {
    const fromTle = { ...tleEntry, noradId: "" };
    const malformedTle = { ...tleEntry, line1: "1 ABCDEU", noradId: "" };

    assert.equal(getQueryableNoradId(fromTle), "12345");
    assert.equal(getExportNoradId(fromTle), "12345");
    assert.equal(getQueryableNoradId(malformedTle), "");
    assert.equal(getExportNoradId(malformedTle), "ABCDE");
});

test("catalog metadata preserves a supplied external NORAD identifier", () => {
    assert.equal(withCatalogMetadata(tleEntry).noradId, "external");
});

test("OMM XML exports escape catalogue data without altering its semantic values", () => {
    const xml = formatCatalogEntryToOmmXml({
        ...tleEntry,
        name: `SAT & <TEST> "ONE" 'TWO'`,
        line1: "1 12345U &",
        line2: "2 12345 <",
        noradId: "external&value"
    });

    assert.match(xml, /<OBJECT_NAME>SAT &amp; &lt;TEST&gt; &quot;ONE&quot; &apos;TWO&apos;<\/OBJECT_NAME>/);
    assert.match(xml, /<TLE_LINE1>1 12345U &amp;<\/TLE_LINE1>/);
    assert.match(xml, /<TLE_LINE2>2 12345 &lt;<\/TLE_LINE2>/);
    assert.match(xml, /<NORAD_CAT_ID>external&amp;value<\/NORAD_CAT_ID>/);
});

test("OMM XML imports decode escaped catalogue values emitted by the exporter", () => {
    const entry = {
        ...tleEntry,
        name: `SAT & <TEST> "ONE" 'TWO'`,
        noradId: ""
    };

    const parsed = parseOmmXmlCatalog(formatCatalogEntryToOmmXml(entry));

    assert.equal(parsed.skipped, 0);
    assert.equal(parsed.entries[0].name, entry.name);
});
