import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("project lifecycle round-trips authored planner events but never derived pass events", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        let projectName = "Planner mission";
        let plannerEvents = [{
            id: "manual-review",
            kind: "manual",
            title: "Review",
            start: "2026-08-18T10:00:00.000Z",
            end: "2026-08-18T11:00:00.000Z",
            color: "blue",
            metadata: { stationId: "station:legacy" }
        }];
        let clearCount = 0;
        let restored = null;
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
            getPlannerManualEvents: () => plannerEvents,
            clearPlannerManualEvents: () => { clearCount += 1; plannerEvents = []; },
            restorePlannerManualEvents: async (items, context) => { restored = { items, context }; plannerEvents = items; },
            restoreGroundStations: async () => ({ restored: ["station:new"], failed: [], idMap: { "station:legacy": "station:new" } }),
            getSimulationState: () => ({ mode: "range", startDate: new Date("2026-08-18T00:00:00.000Z"), endDate: new Date("2026-08-19T00:00:00.000Z") }),
            applySimulationRange: () => {},
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });

        const saved = lifecycle.buildDocument();
        assert.deepEqual(saved.plannerEvents.map((event) => event.id), ["manual-review"]);
        const file = {
            name: "planner.json",
            text: async () => JSON.stringify({
                ...saved,
                plannerEvents: [
                    ...saved.plannerEvents,
                    { id: "derived", kind: "pass-aos", time: "2026-08-18T10:30:00.000Z" }
                ]
            })
        };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.equal(clearCount, 1);
        assert.deepEqual(restored?.items.map((event) => event.id), ["manual-review"]);
        assert.deepEqual(restored?.context.groundStationIdMap, { "station:legacy": "station:new" });
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

test("project lifecycle persists ground-station RF data and restores it through the local layer factory", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        let projectName = "RF mission";
        const layerNames = new Map([["gst:7", "Madrid operations"]]);
        const restoredEntries = [];
        const restoredTrees = [];
        const stations = new Map([["gst:7", {
            id: "gst:7",
            name: "Madrid",
            latitude_deg: 40.417,
            longitude_deg: -3.704,
            altitude_m: 667,
            visible: false,
            coverage_visible: true,
            min_elevation_deg: 8,
            antenna_diameter_m: 2.4,
            antenna_efficiency: 0.62,
            frequency_mhz: 2200,
            polarization: "RHCP",
            tx_power_dbm: 43,
            system_temperature_k: 180,
            operation_mode: "tracking",
            mechanical_elevation_min_deg: 5,
            mechanical_elevation_max_deg: 85,
            entity: { cesium: true },
            coverageEntity: { cesium: true },
            coverageVolumeEntity: { cesium: true },
            patternPrimitive: { cesium: true }
        }]]);
        const tree = {
            folders: [{ id: "folder:ops", name: "Operations", parentId: null, expanded: true }],
            layerParents: { "gst:7": "folder:ops" }
        };
        const lifecycle = createProjectLifecycle({
            getProjectName: () => projectName,
            setProjectName: (value) => { projectName = value; },
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => [],
            setAllSatelliteLayersActive: () => {},
            setSatelliteLayerActive: () => {},
            getGroundStationLayers: () => stations,
            removeGroundStationLayer: (id) => stations.delete(id),
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => layerNames,
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => ({
                getProjectTree: () => tree,
                setProjectTree: (snapshot) => restoredTrees.push(snapshot),
                clearProjectTree: () => {},
                renderList: () => {}
            }),
            restoreGroundStations: async (entries) => {
                restoredEntries.push(...entries);
                entries.forEach((entry) => stations.set(entry.id, { ...entry, entity: { cesium: true } }));
                return { restored: entries.map((entry) => entry.id), failed: [], idMap: {} };
            },
            getSimulationState: () => ({ mode: "realtime", startDate: new Date(), endDate: new Date() }),
            applySimulationRange: () => {},
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });

        const saved = lifecycle.buildDocument();
        assert.equal(saved.groundStations.length, 1);
        assert.deepEqual(saved.groundStations[0], {
            id: "gst:7",
            name: "Madrid",
            latitude_deg: 40.417,
            longitude_deg: -3.704,
            altitude_m: 667,
            visible: false,
            coverage_visible: true,
            min_elevation_deg: 8,
            antenna_diameter_m: 2.4,
            antenna_efficiency: 0.62,
            frequency_mhz: 2200,
            polarization: "RHCP",
            tx_power_dbm: 43,
            system_temperature_k: 180,
            operation_mode: "tracking",
            mechanical_elevation_min_deg: 5,
            mechanical_elevation_max_deg: 85
        });

        const file = { name: "rf-mission.json", text: async () => JSON.stringify(saved) };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.deepEqual(restoredEntries, saved.groundStations);
        assert.equal(stations.get("gst:7")?.visible, false);
        assert.equal(layerNames.get("gst:7"), "Madrid operations");
        assert.deepEqual(restoredTrees, [tree]);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test("project lifecycle remaps tree and names when a legacy ground-station id is replaced", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        const layerNames = new Map();
        let restoredTree = null;
        const project = {
            format: "orbit-project",
            version: 1,
            name: "Legacy station",
            satellites: [],
            manualOrbits: [],
            celestialBodies: [],
            layerNames: { "station:legacy": "Legacy antenna" },
            layerTree: { folders: [], layerParents: { "station:legacy": null } },
            groundStations: [{ id: "station:legacy", latitude_deg: 40, longitude_deg: -3 }],
            simulation: {}
        };
        const lifecycle = createProjectLifecycle({
            getProjectName: () => null,
            setProjectName: () => {},
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => [],
            setAllSatelliteLayersActive: () => {},
            setSatelliteLayerActive: () => {},
            getGroundStationLayers: () => new Map(),
            removeGroundStationLayer: () => {},
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => layerNames,
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => ({ setProjectTree: (snapshot) => { restoredTree = snapshot; }, clearProjectTree: () => {}, renderList: () => {} }),
            restoreGroundStations: async () => ({ restored: ["gst:4"], failed: [], idMap: { "station:legacy": "gst:4" } }),
            getSimulationState: () => ({ mode: "realtime", startDate: new Date(), endDate: new Date() }),
            applySimulationRange: () => {},
            showConfirm: async () => true,
            showAlert: () => {},
            getAlertTitle: () => "Orbit"
        });

        const file = { name: "legacy.json", text: async () => JSON.stringify(project) };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.equal(layerNames.get("gst:4"), "Legacy antenna");
        assert.deepEqual(restoredTree?.layerParents, { "gst:4": null });
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

test("project lifecycle omits local OEM ids and safely replays saved SP3 ids after registry hydration", async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const events = new EventTarget();
    globalThis.window = events;
    globalThis.document = { querySelectorAll: () => [] };
    try {
        const localOemId = "OEM local source";
        const preciseId = "precise:project-product:G01";
        let projectName = "OEM and SP3";
        let preciseMetadataReady = false;
        let activeIds = ["ISS", localOemId, preciseId];
        const activationCalls = [];
        const restorationNotifications = [];
        const restorationOrder = [];
        const alerts = [];
        const lifecycle = createProjectLifecycle({
            getProjectName: () => projectName,
            setProjectName: (value) => { projectName = value; },
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            getActiveSatelliteIds: () => activeIds.slice(),
            setAllSatelliteLayersActive: (active) => {
                if (!active) activeIds = [];
            },
            setSatelliteLayerActive: (id, active) => {
                activationCalls.push([id, active]);
                if (active && !activeIds.includes(id)) activeIds.push(id);
                if (!active) activeIds = activeIds.filter((candidate) => candidate !== id);
                return true;
            },
            getGroundStationLayers: () => new Map(),
            removeGroundStationLayer: () => {},
            clearDuplicateLayers: () => {},
            getLayerNameOverrides: () => new Map(),
            clearSatelliteVisualizationConfigs: () => {},
            getObjectSidebar: () => null,
            getSimulationState: () => ({ mode: "range", startDate: new Date(), endDate: new Date() }),
            applySimulationRange: () => {},
            restoreSimulation: () => restorationOrder.push("simulation"),
            shouldPersistSatellite: (id) => id !== localOemId,
            shouldClearSatelliteOnProjectReset: (id) => id === localOemId,
            getSatelliteRestoreDisposition: (id) => {
                if (id === "legacy-oem") return "skip";
                if (id === preciseId) return preciseMetadataReady ? "restore" : "defer";
                return "restore";
            },
            onSatelliteLayersRestored: (ids, context) => {
                restorationOrder.push(`layers:${ids.join(",")}`);
                restorationNotifications.push({ ids, context });
            },
            showConfirm: async () => true,
            showAlert: (message) => alerts.push(message),
            getAlertTitle: () => "Orbit"
        });

        const saved = lifecycle.buildDocument();
        assert.deepEqual(saved.satellites, ["ISS", preciseId]);
        assert.equal(JSON.stringify(saved).includes("OEM local source"), false, "the project has no local OEM id or bytes");

        const file = {
            name: "saved-scene.json",
            text: async () => JSON.stringify({
                ...saved,
                satellites: ["ISS", "legacy-oem", preciseId]
            })
        };
        assert.equal(await lifecycle.loadFile(file), true);
        assert.ok(activationCalls.some(([id, active]) => id === localOemId && active === false), "reset removes the old OEM track before generic cleanup");
        assert.ok(activationCalls.some(([id, active]) => id === "ISS" && active === true));
        assert.equal(activationCalls.some(([id, active]) => id === "legacy-oem" && active === true), false);
        assert.equal(activationCalls.some(([id, active]) => id === preciseId && active === true), false, "SP3 waits for its registry metadata");
        assert.deepEqual(restorationOrder, ["simulation", "layers:ISS"], "MTR revalidation receives an already-restored simulation state");
        assert.deepEqual(restorationNotifications, [{ ids: ["ISS"], context: {
            deferred: false,
            project: JSON.parse(await file.text()),
            skipped: ["legacy-oem"]
        } }]);
        assert.equal(alerts.length, 1, "a skipped legacy local source is explained once");

        assert.deepEqual(lifecycle.restoreDeferredSatelliteLayers(), {
            restored: [], deferred: [preciseId], skipped: []
        });
        preciseMetadataReady = true;
        assert.deepEqual(lifecycle.restoreDeferredSatelliteLayers(), {
            restored: [preciseId], deferred: [], skipped: []
        });
        assert.equal(activationCalls.some(([id, active]) => id === preciseId && active === true), true);
        assert.deepEqual(restorationOrder, ["simulation", "layers:ISS", "layers:precise:project-product:G01"]);
        assert.deepEqual(lifecycle.restoreDeferredSatelliteLayers(), {
            restored: [], deferred: [], skipped: []
        }, "the queued SP3 id is drained exactly once");
        assert.deepEqual(restorationNotifications.at(-1), {
            ids: [preciseId],
            context: { deferred: true, skipped: [] }
        });
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test("main revalidates and re-primes hydrated project SP3 layers without an implicit MTR expansion", () => {
    const source = readFileSync(new URL("../../main.js", import.meta.url), "utf8");

    assert.match(source, /shouldPersistSatellite:\s*shouldPersistSatelliteInProject/);
    assert.match(source, /getSatelliteRestoreDisposition:\s*getSatelliteRestoreDisposition/);
    assert.match(source, /onSatelliteLayersRestored:\s*revalidateRestoredProjectSatelliteLayers/);
    assert.match(source, /projectLifecycle\.restoreDeferredSatelliteLayers\(\)/);
    assert.match(source, /validateObjectFitsMTR\(getObjectIntrinsicTimeRange\(id\)\)/);
    assert.match(source, /fit\.requiresExpansion/);
    assert.match(source, /setSatelliteLayerActive\(id, false\)/);
    assert.match(source, /applyMasterTimeRangeToSimulation\(\)/);
    assert.match(source, /refreshSatelliteOverlays\(viewer\)/);
});
