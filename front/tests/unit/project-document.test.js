import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectDocument, isProjectDocument, normalizeProjectName, normalizeProjectPlannerEvents, PROJECT_FORMAT, PROJECT_VERSION } from "../../js/runtime/projectDocument.js";

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
        manualOrbits: [manualOrbit],
        celestialBodies: [{ kind: "earth", visible: false }, { kind: "moon", visible: false }, "sun", { kind: "moon", visible: true }, { kind: "invalid" }]
    });
    assert.equal(document.format, PROJECT_FORMAT);
    assert.equal(document.version, PROJECT_VERSION);
    assert.equal(document.name, "Mission Alpha");
    assert.deepEqual(document.satellites, ["ISS"]);
    assert.deepEqual(document.manualOrbits, [manualOrbit]);
    assert.notEqual(document.manualOrbits[0], manualOrbit);
    assert.notEqual(document.manualOrbits[0].visual, manualOrbit.visual);
    assert.deepEqual(document.celestialBodies, [{ kind: "moon", visible: false }, { kind: "sun", visible: true }]);
    assert.deepEqual(document.layerTree, { folders: [], layerParents: {} });
    assert.equal(isProjectDocument(document), true);
});

test("project document validation rejects unrelated content and supplies a name fallback", () => {
    assert.equal(isProjectDocument({ format: PROJECT_FORMAT, version: 2 }), false);
    assert.equal(normalizeProjectName("   "), "Untitled project");
});

test("project documents persist only valid authored manual planner events", () => {
    const manual = {
        id: "planner:review",
        kind: "manual",
        title: "Mission review",
        start: "2026-08-18T10:00:00.000Z",
        end: "2026-08-18T11:00:00.000Z",
        color: "purple",
        metadata: { stationId: "station:old" }
    };
    const events = [
        manual,
        { id: "derived-pass", kind: "pass-aos", time: "2026-08-18T10:30:00.000Z" },
        { id: "bad-manual", kind: "manual", title: "Bad", start: manual.end, end: manual.start, color: "blue" }
    ];
    const document = buildProjectDocument({ name: "Planner", plannerEvents: events });
    assert.deepEqual(document.plannerEvents.map((event) => [event.id, event.source, event.kind, event.colorToken]), [
        ["planner:review", "manual", "manual", "purple"]
    ]);
    assert.deepEqual(normalizeProjectPlannerEvents(events), document.plannerEvents);
});
