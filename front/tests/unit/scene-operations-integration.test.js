import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebarSource = readFileSync(
    new URL("../../js/objectSidebar.js", import.meta.url),
    "utf8"
);

function sourceBetween(startMarker, endMarker) {
    const start = sidebarSource.indexOf(startMarker);
    const end = sidebarSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return sidebarSource.slice(start, end);
}

test("scene imports and catalogue refresh report a cancellable lifecycle to the shared activity ledger", () => {
    const preview = sourceBetween("async function requestPreciseProductPreview()", "async function importPreciseProductFiles");
    const preciseImport = sourceBetween("async function importPreciseProductFiles", "function requestPreciseProductImport");
    const catalogImport = sourceBetween("async function importCatalogFile", "importSatelliteFileInput?.addEventListener");
    const refresh = sourceBetween("async function refreshCatalogFromCelestrak()", "function openContextMenu");

    assert.match(sidebarSource, /OPERATION_SCOPES\.SCENE/);
    assert.match(sidebarSource, /function beginSceneOperation\(/);
    assert.match(sidebarSource, /function cancelSceneOperation\(/);
    assert.match(preview, /beginSceneOperation\("precise-preview"/);
    assert.match(preview, /controller:\s*abortController/);
    assert.match(preview, /cancelSceneOperation\(operationId/);
    assert.match(preciseImport, /beginSceneOperation\("precise-import"/);
    assert.match(preciseImport, /signal:\s*abortController\.signal/);
    assert.match(catalogImport, /beginSceneOperation\("catalog-import"/);
    assert.match(catalogImport, /signal:\s*abortController\.signal/);
    assert.match(refresh, /beginSceneOperation\("catalog-refresh"/);
    assert.match(refresh, /signal:\s*abortController\.signal/);
    assert.match(refresh, /advanceSceneOperation\(operationId/);
});

test("project resets and sidebar teardown cancel only owned scene work and remove listeners", () => {
    const teardown = sourceBetween("destroy() {", "sidebar.remove();");

    assert.match(sidebarSource, /window\.addEventListener\("orbit:scene-operations-cancel", onSceneOperationsCancel\)/);
    assert.match(sidebarSource, /function cancelOwnedSceneOperations\([\s\S]*?abortPreciseProductPreviewRequest\(\)[\s\S]*?abortPreciseProductImportRequest\(\)[\s\S]*?abortCatalogRefreshRequest\(\)/);
    assert.match(teardown, /cancelOwnedSceneOperations\("Operación de escena cancelada al cerrar el panel\."\)/);
    assert.match(teardown, /window\.removeEventListener\(ORBIT_OPERATION_CANCEL_REQUEST_EVENT, onSceneOperationCancelRequest\)/);
    assert.match(teardown, /window\.removeEventListener\("orbit:scene-operations-cancel", onSceneOperationsCancel\)/);
});

test("batch activation observes cancellation between imported scene objects", () => {
    const activation = sourceBetween("async function addImportedSatellitesToView", "async function importNativeOemEphemeris");
    const catalogActivation = sourceBetween("async function addSelectedCatalogLayers()", "catalogAddSelectedBtn.addEventListener");

    assert.match(activation, /isCancelled\(\)\s*\)\s*\{\s*return BULK_PROCESS_ABORTED;/);
    assert.match(activation, /onProgress\?\.\(done, total\)/);
    assert.match(catalogActivation, /beginSceneOperation\("catalog-activate"/);
    assert.match(catalogActivation, /abortController\.signal\.aborted/);
    assert.match(catalogActivation, /advanceSceneOperation\(operationId/);
});
