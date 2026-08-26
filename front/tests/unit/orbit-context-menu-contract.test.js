import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getOrbitContextSubmenuPosition } from "../../../react-ui/src/components/orbitContextMenuLayout.js";

const ORBIT_CONTEXT_MENU_WIDTH = 286;
const ORBIT_CONTEXT_MENU_GAP = 8;

const globeMenuSource = readFileSync(
    new URL("../../../react-ui/src/components/SatelliteContextMenu.jsx", import.meta.url),
    "utf8"
);
const layerMenuSource = readFileSync(
    new URL("../../../react-ui/src/components/LayerContextMenu.jsx", import.meta.url),
    "utf8"
);
const sidebarSource = readFileSync(
    new URL("../../js/objectSidebar.js", import.meta.url),
    "utf8"
);
const runtimeSource = readFileSync(
    new URL("../../main.js", import.meta.url),
    "utf8"
);

test("orbit context menus present the requested View and Ephemerides hierarchy", () => {
    for (const source of [globeMenuSource, layerMenuSource]) {
        assert.match(source, /title="Vista"/);
        assert.match(source, /title="Efemérides"/);
        assert.match(source, /title="Centrar vista"/);
        assert.match(source, /title=\{visibilityTitle\}/);
        assert.match(source, /title=\{groundTrackTitle\}/);
        assert.match(source, /title="Opciones de visualización"/);
        assert.match(source, /title="Propagación"/);
        assert.match(source, /title="Explicar parámetros orbitales"/);
        assert.match(source, /title="Exportar…"/);
        assert.match(source, /title="Eliminar capa"/);
        assert.match(source, /aria-haspopup="menu"/);
    }

    assert.match(globeMenuSource, /id="satelliteContextViewMenu"/);
    assert.match(globeMenuSource, /id="satelliteContextEphemeridesMenu"/);
    assert.match(layerMenuSource, /id="catalogContextViewMenu"/);
    assert.match(layerMenuSource, /id="catalogContextEphemeridesMenu"/);
});

test("globe actions use the explicit layer id instead of a stale tree-menu target", () => {
    assert.match(globeMenuSource, /new CustomEvent\("orbit:layer-context-action"/);
    assert.match(globeMenuSource, /detail: \{ action, id: menu\.id, source: "globe" \}/);
    assert.match(globeMenuSource, /type === "visualization" \? "viz" : type/);

    const explicitRouting = sidebarSource.slice(
        sidebarSource.indexOf('if (action === "explain")'),
        sidebarSource.indexOf("const actionButtons = {")
    );
    assert.match(explicitRouting, /openTleInfo\(targetId, "explain"\)/);
    assert.match(explicitRouting, /onOpenVisualizationOptions\?\.\(targetId\)/);
    assert.match(explicitRouting, /onToggleGroundTrack\?\.\(targetId\)/);
    assert.match(explicitRouting, /openExportModal\(targetId\)/);
    assert.match(explicitRouting, /onToggleObjectLayer\?\.\(targetId, false\)/);
    assert.match(explicitRouting, /openGroundStationModal\(targetId\)/);
});

test("globe context state reflects the current layer eye and ground-track state", () => {
    const globeOpen = runtimeSource.slice(
        runtimeSource.indexOf("function showSatelliteContextMenuAt"),
        runtimeSource.indexOf('window.addEventListener("orbit:satellite-context-action"')
    );
    assert.match(globeOpen, /visible: getCompositeLayerVisibility\(satelliteId\) !== false/);
    assert.match(globeOpen, /groundTrackVisible:/);
    assert.match(globeOpen, /orbit_ground_track_show === true/);
});

test("orbit submenus flip side near the right edge and remain inside the viewport", () => {
    const viewportWidth = 900;
    const viewportHeight = 600;
    const position = getOrbitContextSubmenuPosition({ left: 790, top: 510 }, {
        level: 2,
        height: 190,
        viewportWidth,
        viewportHeight
    });

    assert.ok(position.left >= ORBIT_CONTEXT_MENU_GAP);
    assert.ok(position.left <= viewportWidth - ORBIT_CONTEXT_MENU_WIDTH - ORBIT_CONTEXT_MENU_GAP);
    assert.ok(position.top >= ORBIT_CONTEXT_MENU_GAP);
    assert.ok(position.top <= viewportHeight - 190 - ORBIT_CONTEXT_MENU_GAP);
    assert.ok(position.left < 790, "a submenu near the right edge opens to the left");
});
