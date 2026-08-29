import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(
    new URL("../../js/objectSidebar.js", import.meta.url),
    "utf8"
);
const treeMenu = readFileSync(
    new URL("../../../react-ui/src/components/TreeContextMenu.jsx", import.meta.url),
    "utf8"
);
const runtime = readFileSync(
    new URL("../../main.js", import.meta.url),
    "utf8"
);

function functionSource(name, endMarker) {
    const start = sidebar.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} must remain owned by objectSidebar`);
    const end = sidebar.indexOf(endMarker, start);
    assert.notEqual(end, -1, `could not isolate ${name}`);
    return sidebar.slice(start, end);
}

test("deleting a nonempty folder confirms and removes its complete operational branch", () => {
    const removal = functionSource("removeFolderAndContents", "function reserveFolderAssignment");

    assert.match(removal, /getFolderLayerIds\(folder\.id\)/);
    assert.match(removal, /layerTree\.getFolderDescendantIds\(folder\.id\)/);
    assert.match(removal, /title: "Eliminar carpeta"/);
    assert.match(removal, /confirmText: "Eliminar contenido"/);
    assert.match(removal, /onToggleObjectLayer\?\.\(layerId, false\)/);
    assert.match(removal, /await Promise\.resolve/);
    assert.match(removal, /layerTree\.removeFolder\(folder\.id\)/);
    assert.match(removal, /markLayerTreeDirty\(\)/);
    assert.match(removal, /Se eliminarán de la escena/);
});

test("folder and Layers + additions share one semantic action owner", () => {
    const actionOwner = functionSource("executeLayerAddAction", "function showFolderContextMenu");
    for (const action of [
        "catalog",
        "import-satellite",
        "import-gnss",
        "manual-orbit",
        "moon",
        "sun",
        "station",
        "folder"
    ]) {
        assert.match(actionOwner, new RegExp(`normalizedAction === "${action}"`));
    }

    const contextRouting = functionSource("executeFolderContextAction", "folderContextMenu.addEventListener");
    assert.match(contextRouting, /await executeLayerAddAction\(/);
    assert.match(sidebar, /executeLayerAddAction\("catalog"\)/);
    assert.match(sidebar, /executeLayerAddAction\("import-satellite"\)/);
    assert.match(sidebar, /executeLayerAddAction\("import-gnss"\)/);
    assert.match(sidebar, /executeLayerAddAction\("manual-orbit"\)/);
    assert.match(sidebar, /executeLayerAddAction\("station"\)/);
    assert.match(sidebar, /executeLayerAddAction\("folder"\)/);
    assert.match(sidebar, /window\.addEventListener\("orbit:manual-orbit-created", onManualOrbitCreated\)/);
    assert.match(runtime, /new CustomEvent\("orbit:manual-orbit-created"/);
    assert.match(runtime, /detail: \{ id: imported\.id, name: imported\.name \}/);
    assert.match(sidebar, /pendingFolderAssignment\?\.source === "catalog"/);

    for (const action of ["catalog", "import-satellite", "import-gnss", "manual-orbit", "moon", "sun", "station"]) {
        assert.match(sidebar, new RegExp(`data-folder-action="${action}"`));
    }
});

test("the React folder menu exposes every add family available from Layers +", () => {
    for (const title of [
        "Añadir satélite",
        "Cuerpo celeste",
        "Estación terrestre",
        "Desde el catálogo",
        "Importar archivo",
        "Producto GNSS",
        "Generar órbita",
        "Luna",
        "Sol"
    ]) {
        assert.match(treeMenu, new RegExp(`title="${title}"`));
    }
    assert.match(treeMenu, /submit\("import-satellite"\)/);
    assert.match(treeMenu, /submit\("import-gnss"\)/);
    assert.match(treeMenu, /submit\("manual-orbit"\)/);
    assert.match(treeMenu, /submit\("moon"\)/);
    assert.match(treeMenu, /submit\("sun"\)/);
    assert.match(treeMenu, /id="treeContextBodiesMenu"/);
});
