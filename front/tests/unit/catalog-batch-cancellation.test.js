import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    BULK_PROCESS_ABORTED,
    processInChunks
} from "../../js/objectSidebar.js";

const sidebarSource = readFileSync(
    new URL("../../js/objectSidebar.js", import.meta.url),
    "utf8"
);
const catalogModalSource = readFileSync(
    new URL("../../../react-ui/src/components/CatalogModal.jsx", import.meta.url),
    "utf8"
);

function sourceBetween(startMarker, endMarker) {
    const start = sidebarSource.indexOf(startMarker);
    const end = sidebarSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return sidebarSource.slice(start, end);
}

test("a deliberate batch cancellation stops before the next activation", async () => {
    const processed = [];
    const progress = [];

    const result = await processInChunks(
        ["first", "declined", "must-not-run"],
        async (id) => {
            processed.push(id);
            return id === "declined" ? BULK_PROCESS_ABORTED : undefined;
        },
        (done, total) => progress.push([done, total])
    );

    assert.deepEqual(processed, ["first", "declined"]);
    assert.deepEqual(progress, [[2, 3]]);
    assert.deepEqual(result, {
        cancelled: true,
        processed: 2,
        total: 3
    });
});

test("ordinary false callback values do not accidentally cancel a generic batch", async () => {
    const processed = [];
    const result = await processInChunks(
        ["first", "second"],
        (id) => {
            processed.push(id);
            return false;
        }
    );

    assert.deepEqual(processed, ["first", "second"]);
    assert.deepEqual(result, {
        cancelled: false,
        processed: 2,
        total: 2
    });
});

test("a cancelled MTR activation preserves the catalog selection and modal", () => {
    const addSelected = sourceBetween(
        "async function addSelectedCatalogLayers()",
        "catalogAddSelectedBtn.addEventListener"
    );
    const cancellationStart = addSelected.indexOf("if (batchResult.cancelled)");
    const cancellationEnd = addSelected.indexOf("} catch", cancellationStart);

    assert.notEqual(cancellationStart, -1, "the batch outcome must be inspected");
    assert.notEqual(cancellationEnd, -1, "the cancellation branch must finish before error handling");
    const cancellation = addSelected.slice(cancellationStart, cancellationEnd);

    assert.match(addSelected, /if \(activated === false\)\s*\{\s*return BULK_PROCESS_ABORTED;/);
    assert.match(cancellation, /setCatalogBusyState\(false\)/);
    assert.match(cancellation, /se mantuvo el rango temporal maestro actual/);
    assert.doesNotMatch(cancellation, /selectedCatalogIds\.clear\(\)/);
    assert.doesNotMatch(cancellation, /closeCatalogModal\(\)/);
});

test("catalog close affordances are disabled while an async batch is busy", () => {
    const closeCatalog = sourceBetween(
        "const closeCatalogModal = () => {",
        "function openCatalogFilterModal()"
    );

    assert.match(closeCatalog, /if \(catalogBusy\) return;/);
    assert.match(catalogModalSource, /event\.target === event\.currentTarget && !headerBusy && action\("close"\)/);
    assert.match(catalogModalSource, /<PanelCloseButton[\s\S]*?disabled=\{headerBusy\}[\s\S]*?action\("close"\)/);
});
