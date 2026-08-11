import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarSource = readFileSync(
    new URL("../../js/objectSidebar.js", import.meta.url),
    "utf8"
);

const addMenuStart = sidebarSource.indexOf('const addMenu = document.createElement("div");');
const addMenuEnd = sidebarSource.indexOf("const preciseProductSlotsMarkup", addMenuStart);

assert.notEqual(addMenuStart, -1, "objectSidebar must retain the Layers + menu owner");
assert.notEqual(addMenuEnd, -1, "could not isolate the Layers + menu markup");

const addMenuSource = sidebarSource.slice(addMenuStart, addMenuEnd);

function actionMarkup(id) {
    const marker = `id="${id}"`;
    const markerIndex = addMenuSource.indexOf(marker);
    assert.notEqual(markerIndex, -1, `Layers + menu must retain ${marker}`);

    const start = addMenuSource.lastIndexOf("<button", markerIndex);
    const end = addMenuSource.indexOf("</button>", markerIndex);
    assert.notEqual(start, -1, `${marker} must remain a button action`);
    assert.notEqual(end, -1, `${marker} must have a closing button tag`);
    return addMenuSource.slice(start, end + "</button>".length);
}

test("Layers + menu adopts the shared action-menu surface instead of the legacy bare dropdown", () => {
    assert.match(addMenuSource, /addMenu\.id\s*=\s*["']layerAddMenu["']/);
    assert.match(addMenuSource, /orbit-action-menu/, "the + menu must use the shared menu surface class");
    assert.match(addMenuSource, /(?:data-context-menu=["']true["']|dataset\.contextMenu\s*=\s*["']true["'])/);
    assert.match(addMenuSource, /role=["']menu["']/);
    assert.match(addMenuSource, /orbit-action-menu__header/);
    assert.match(addMenuSource, /data-context-menu-header=["']true["']/);
    assert.match(addMenuSource, /data-context-menu-icon=["']true["']/);
    assert.match(addMenuSource, /data-context-menu-title=["']true["']/);
});

test("Layers + actions carry the shared menuitem title and description semantics", () => {
    for (const id of [
        "addFolderBtn",
        "addSatelliteBtn",
        "addTleFromCatalogBtn",
        "importSatelliteBtn",
        "importPreciseProductBtn",
        "generateOrbitBtn",
        "addMoonBtn",
        "addSunBtn",
        "addGroundStationBtn"
    ]) {
        const markup = actionMarkup(id);
        assert.match(markup, /orbit-action-menu__item/, `${id} must inherit the common item styling`);
        assert.match(markup, /data-context-menu-action=["']true["']/);
        assert.match(markup, /role=["']menuitem["']/);
        assert.match(markup, /data-context-menu-action-title=["']true["']/);
        assert.match(markup, /data-context-menu-action-description=["']true["']/);
    }
});

test("Layers + submenu levels are independent shared action menus", () => {
    const submenuSurfaces = addMenuSource.match(/(?:folder-add-submenu|data-layer-add-submenu)[^>]*orbit-action-menu|orbit-action-menu[^>]*(?:folder-add-submenu|data-layer-add-submenu)/g) || [];

    assert.ok(submenuSurfaces.length >= 3, "satellite, body and their parent submenu must use the shared surface");
    assert.match(addMenuSource, /aria-haspopup=["']menu["']/);
    assert.match(addMenuSource, /aria-expanded=/, "submenu controls must expose their open state");
    assert.match(addMenuSource, /orbit-action-menu__chevron/, "submenu controls must use the shared affordance");
});
