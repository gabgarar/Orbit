import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectDocument, isProjectDocument, normalizeProjectName, PROJECT_FORMAT, PROJECT_VERSION } from "../../js/runtime/projectDocument.js";

test("project document normalizes optional data into a stable export contract", () => {
    const manualOrbit = {
        id: "manual:design-orbit",
        name: "Design orbit",
        definitionSource: "keplerian",
        visual: { visible: false, overrides: { orbit_ground_track_show: false } }
    };
    const document = buildProjectDocument({
        name: "  Mission Alpha  ",
        satellites: ["ISS"],
        layerNames: { ISS: "Station" },
        manualOrbits: [manualOrbit]
    });
    assert.equal(document.format, PROJECT_FORMAT);
    assert.equal(document.version, PROJECT_VERSION);
    assert.equal(document.name, "Mission Alpha");
    assert.deepEqual(document.satellites, ["ISS"]);
    assert.deepEqual(document.manualOrbits, [manualOrbit]);
    assert.notEqual(document.manualOrbits[0], manualOrbit);
    assert.notEqual(document.manualOrbits[0].visual, manualOrbit.visual);
    assert.deepEqual(document.layerTree, { folders: [], layerParents: {} });
    assert.equal(isProjectDocument(document), true);
});

test("project document validation rejects unrelated content and supplies a name fallback", () => {
    assert.equal(isProjectDocument({ format: PROJECT_FORMAT, version: 2 }), false);
    assert.equal(normalizeProjectName("   "), "Untitled project");
});
