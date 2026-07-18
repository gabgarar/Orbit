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
