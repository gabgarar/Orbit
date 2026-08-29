import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(
    new URL("../../../react-ui/src/hooks/useGroundStationsPanelVisibility.js", import.meta.url),
    "utf8"
);
const groundStations = readFileSync(
    new URL("../../../react-ui/src/components/GroundStationsPanel.jsx", import.meta.url),
    "utf8"
);
const styles = readFileSync(
    new URL("../../../react-ui/src/styles.css", import.meta.url),
    "utf8"
);
const consumers = Object.fromEntries([
    "ObjectDetailsPanel.jsx",
    "ManualOrbitPanel.jsx",
    "PropagatedOrbitParametersPanel.jsx",
    "ConfigPanel.jsx",
    "SatelliteVisualizationDialog.jsx"
].map((file) => [file, readFileSync(new URL(`../../../react-ui/src/components/${file}`, import.meta.url), "utf8")]));

test("Ground Stations temporarily owns the right-side workspace without closing its underlying panels", () => {
    assert.match(hook, /GROUND_STATIONS_PANEL_STATE_EVENT = "orbit:ground-stations-panel-state"/);
    assert.match(hook, /let groundStationsPanelOpen = false/);
    assert.match(hook, /publishGroundStationsPanelState\(open, detail = \{\}\)/);
    assert.match(hook, /document\.documentElement\.classList\.toggle\("orbit-ground-stations-panel-open", groundStationsPanelOpen\)/);
    assert.match(hook, /detail:\s*\{\s*open: groundStationsPanelOpen/);
    assert.match(groundStations, /publishGroundStationsPanelState\(open, \{ floating \}\)/);
    assert.match(groundStations, /publishGroundStationsPanelState\(false\)/);
    for (const source of Object.values(consumers)) {
        assert.match(source, /useGroundStationsPanelVisibility/);
        assert.match(source, /groundStationsPanelOpen/);
    }
    assert.match(styles, /:root\.orbit-ground-stations-panel-open #leftInfoPanel\.open/);
    assert.match(consumers["ObjectDetailsPanel.jsx"], /stationDesignMode \|\| groundStationsPanelOpen/);
    assert.match(consumers["ConfigPanel.jsx"], /if \(!open \|\| groundStationsPanelOpen\) return null/);
    assert.match(consumers["ManualOrbitPanel.jsx"], /if \(!open\) \{[\s\S]*?groundStationsPanelOpen[\s\S]*?status\?\.kind !== "warning"/);
    assert.match(consumers["PropagatedOrbitParametersPanel.jsx"], /if \(!panel\.open\) return null;[\s\S]*?if \(groundStationsPanelOpen\) return null;/);
    assert.match(consumers["SatelliteVisualizationDialog.jsx"], /if \(!data \|\| groundStationsPanelOpen\) return null/);
});
