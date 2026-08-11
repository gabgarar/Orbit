import assert from "node:assert/strict";
import test from "node:test";

import {
    getDefaultOrbitExportFormat,
    getOrbitExportFormat,
    getOrbitExportFormats,
    isSourceOnlyOrbitExport
} from "../../js/features/exports/orbitExportFormats.js";

test("real TLE sources expose the original TLE inside the format selector", () => {
    const formats = getOrbitExportFormats("TLE");
    const tle = formats.find((format) => format.id === "tle");

    assert.equal(tle?.disabled, undefined);
    assert.equal(tle?.label, "TLE");
    assert.equal(isSourceOnlyOrbitExport("tle"), true);
});

test("manual sources expose a disabled synthetic TLE rather than fabricating one", () => {
    const formats = getOrbitExportFormats("MANUAL");
    const synthetic = formats.find((format) => format.id === "tle-synthetic");

    assert.equal(synthetic?.disabled, true);
    assert.match(synthetic?.note || "", /no implementa/i);
    assert.equal(getDefaultOrbitExportFormat("MANUAL"), "csv");
});

test("all sampled GIS formats explain their geometry policy", () => {
    for (const id of ["geojson", "kml", "kmz", "gpkg", "wkt", "wkb"]) {
        const format = getOrbitExportFormat("TLE", id);
        assert.equal(format.id, id);
        assert.ok(format.description.length > 20);
        assert.ok(format.note.length > 20);
    }
    assert.match(getOrbitExportFormat("TLE", "geojson").note, /2D/i);
    assert.match(getOrbitExportFormat("TLE", "geojson").note, /antimeridiano.*segmentos/i);
    assert.match(getOrbitExportFormat("TLE", "kml").note, /muestras/i);
    assert.match(getOrbitExportFormat("TLE", "kml").note, /segmentos/i);
});

test("OMM source exports are visibly derived rather than represented as original bytes", () => {
    const omm = getOrbitExportFormat("OMM", "omm-json");

    assert.equal(omm.label, "OMM JSON derivado");
    assert.match(omm.title, /derivado desde la entrada catalogada/i);
    assert.match(omm.note, /no es una copia byte a byte/i);
});

test("OEM inputs do not masquerade as SGP4 sampled products before their native sample adapter exists", () => {
    const formats = getOrbitExportFormats("OEM");

    assert.ok(formats.length > 1);
    assert.ok(formats.every((format) => format.disabled === true));
    assert.match(getOrbitExportFormat("OEM", "source-oem").note, /perfil derivado/i);
});
