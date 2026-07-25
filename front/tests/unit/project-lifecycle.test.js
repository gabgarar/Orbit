import assert from "node:assert/strict";
import test from "node:test";
import { createProjectLifecycle } from "../../js/runtime/projectLifecycle.js";

test("starting a project always emits the opened event after a cleanup failure", () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        let projectName = null;
        let opened = 0;
        events.addEventListener("orbit:project-opened", () => { opened += 1; });
        const lifecycle = createProjectLifecycle({
            getProjectName: () => projectName,
            setProjectName: (value) => { projectName = value; },
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => [],
            setAllSatelliteLayersActive: () => { throw new Error("stale layer"); },
            setSatelliteLayerActive: () => {},
            getGroundStationLayers: () => new Map(),
            removeGroundStationLayer: () => {},
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => new Map(),
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => null,
            getSimulationState: () => ({ mode: "realtime", startDate: new Date(), endDate: new Date() }),
            applySimulationRange: () => {},
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });
        assert.equal(lifecycle.startNew("Mission Alpha"), true);
        assert.equal(projectName, "Mission Alpha");
        assert.equal(opened, 1);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test("project lifecycle persists and restores a static simulation frame", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        let projectName = null;
        const restoredSnapshots = [];
        const simulation = {
            mode: "static",
            startDate: new Date("2026-07-25T00:00:00.000Z"),
            endDate: new Date("2026-07-25T12:00:00.000Z"),
            currentDate: new Date("2026-07-25T02:06:11.000Z"),
            isPlaying: false,
            speed: 1
        };
        const lifecycle = createProjectLifecycle({
            getProjectName: () => projectName,
            setProjectName: (value) => { projectName = value; },
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => [],
            setAllSatelliteLayersActive: () => {},
            setSatelliteLayerActive: () => {},
            getGroundStationLayers: () => new Map(),
            removeGroundStationLayer: () => {},
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => new Map(),
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => null,
            getSimulationState: () => simulation,
            applySimulationRange: () => { throw new Error("the dedicated simulation restorer must be used"); },
            restoreSimulation: (snapshot) => restoredSnapshots.push(snapshot),
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });

        const saved = lifecycle.buildDocument();
        assert.equal(saved.simulation.mode, "static");
        assert.equal(saved.simulation.currentDate.toISOString(), "2026-07-25T02:06:11.000Z");
        assert.equal(saved.simulation.isPlaying, false);

        const file = { name: "static-frame.json", text: async () => JSON.stringify(saved) };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.equal(restoredSnapshots.length, 1);
        assert.equal(restoredSnapshots[0].mode, "static");
        assert.equal(restoredSnapshots[0].currentDate, "2026-07-25T02:06:11.000Z");
        assert.equal(restoredSnapshots[0].isPlaying, false);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test("project lifecycle serializes manual orbits separately and restores them without catalogue activation", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        let projectName = null;
        const activated = [];
        const restored = [];
        const manualOrbit = {
            id: "manual:design-orbit",
            name: "Design orbit",
            definitionSource: "keplerian",
            epochUtc: "2026-07-20T10:00:00.000Z",
            startTime: "2026-07-20T10:00:00.000Z",
            endTime: "2026-07-20T12:00:00.000Z",
            keplerian: { semi_major_axis_km: 7000 },
            visual: { visible: false, overrides: { orbit_ground_track_show: false } }
        };
        const lifecycle = createProjectLifecycle({
            getProjectName: () => projectName,
            setProjectName: (value) => { projectName = value; },
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => ["ISS", "manual:design-orbit"],
            setAllSatelliteLayersActive: () => {},
            setSatelliteLayerActive: (id) => activated.push(id),
            getGroundStationLayers: () => new Map(),
            removeGroundStationLayer: () => {},
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => new Map(),
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => ({ getProjectTree: () => ({ folders: [], layerParents: {} }), setProjectTree: () => {}, renderList: () => {} }),
            getManualOrbitEntries: () => [manualOrbit],
            restoreManualOrbits: async (entries) => { restored.push(...entries); return { restored: entries.map((entry) => entry.id), failed: [] }; },
            getSimulationState: () => ({ mode: "realtime", startDate: new Date(), endDate: new Date() }),
            applySimulationRange: () => {},
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });

        const saved = lifecycle.buildDocument();
        assert.deepEqual(saved.satellites, ["ISS"]);
        assert.deepEqual(saved.manualOrbits, [manualOrbit]);

        const file = {
            name: "mission.json",
            text: async () => JSON.stringify({
                ...saved,
                // Verify an older/hand-edited accidental copy cannot cause a
                // dangling catalogue activation for this local object.
                satellites: ["ISS", "manual:design-orbit"]
            })
        };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.deepEqual(activated, ["ISS"]);
        assert.deepEqual(restored, [manualOrbit]);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test("project lifecycle persists native celestial body layers without persisting an ephemeris sample", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        let projectName = null;
        let bodies = [{ kind: "moon", visible: false }, { kind: "sun", visible: true }];
        const restored = [];
        let cleared = 0;
        const lifecycle = createProjectLifecycle({
            getProjectName: () => projectName,
            setProjectName: (value) => { projectName = value; },
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => [],
            setAllSatelliteLayersActive: () => {},
            setSatelliteLayerActive: () => {},
            getGroundStationLayers: () => new Map(),
            removeGroundStationLayer: () => {},
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => new Map(),
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => ({ getProjectTree: () => ({ folders: [], layerParents: {} }), setProjectTree: () => {}, renderList: () => {} }),
            getManualOrbitEntries: () => [],
            restoreManualOrbits: async () => ({ restored: [], failed: [] }),
            getCelestialBodies: () => bodies,
            clearCelestialBodies: () => { cleared += 1; bodies = []; },
            restoreCelestialBodies: (entries) => { restored.push(...entries); bodies = entries; },
            getSimulationState: () => ({ mode: "realtime", startDate: new Date(), endDate: new Date() }),
            applySimulationRange: () => {},
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });

        const saved = lifecycle.buildDocument();
        assert.deepEqual(saved.celestialBodies, [{ kind: "moon", visible: false }, { kind: "sun", visible: true }]);

        // Simulate a blank workspace before opening the saved document so no
        // confirmation branch obscures the restore contract.
        projectName = null;
        bodies = [];
        const file = { name: "bodies.json", text: async () => JSON.stringify(saved) };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.equal(cleared, 1);
        assert.deepEqual(restored, saved.celestialBodies);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});
