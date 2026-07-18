import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectDocument, isProjectDocument, normalizeProjectName, PROJECT_FORMAT, PROJECT_VERSION } from "../../js/runtime/projectDocument.js";

test("project document normalizes optional data into a stable export contract", () => {
    const document = buildProjectDocument({ name: "  Mission Alpha  ", satellites: ["ISS"], layerNames: { ISS: "Station" } });
    assert.equal(document.format, PROJECT_FORMAT);
    assert.equal(document.version, PROJECT_VERSION);
    assert.equal(document.name, "Mission Alpha");
    assert.deepEqual(document.satellites, ["ISS"]);
    assert.deepEqual(document.layerTree, { folders: [], layerParents: {} });
    assert.equal(isProjectDocument(document), true);
});

test("project document validation rejects unrelated content and supplies a name fallback", () => {
    assert.equal(isProjectDocument({ format: PROJECT_FORMAT, version: 2 }), false);
    assert.equal(normalizeProjectName("   "), "Untitled project");
});
