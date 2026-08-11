import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    derivePreciseProductPreviewActionState,
    PRECISE_PRODUCT_PREVIEW_ACTION_LABEL,
    PRECISE_PRODUCT_PREVIEW_BUSY_LABEL
} from "../../js/objectSidebar.js";

const sidebarSource = readFileSync(
    new URL("../../js/objectSidebar.js", import.meta.url),
    "utf8"
);

function functionSource(name, endMarker) {
    const start = sidebarSource.indexOf(`function ${name}`);
    const end = sidebarSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `${name} must remain part of the GNSS import lifecycle`);
    assert.notEqual(end, -1, `could not isolate ${name}`);
    return sidebarSource.slice(start, end);
}

test("consecutive GNSS preview sessions always return the import action to a ready state", () => {
    const firstReady = derivePreciseProductPreviewActionState({ hasSp3: true });
    const firstAnalysing = derivePreciseProductPreviewActionState({ hasSp3: true, previewBusy: true });
    const afterFirstTerminalState = derivePreciseProductPreviewActionState({ hasSp3: true });
    const secondAnalysing = derivePreciseProductPreviewActionState({ hasSp3: true, previewBusy: true });
    const afterSecondTerminalState = derivePreciseProductPreviewActionState({ hasSp3: true });

    assert.deepEqual(firstReady, {
        disabled: false,
        label: PRECISE_PRODUCT_PREVIEW_ACTION_LABEL,
        ariaBusy: null
    });
    assert.deepEqual(firstAnalysing, {
        disabled: true,
        label: PRECISE_PRODUCT_PREVIEW_BUSY_LABEL,
        ariaBusy: "true"
    });
    assert.deepEqual(afterFirstTerminalState, firstReady);
    assert.deepEqual(secondAnalysing, firstAnalysing);
    assert.deepEqual(afterSecondTerminalState, firstReady);
    assert.equal(
        derivePreciseProductPreviewActionState({ hasSp3: false }).disabled,
        true,
        "the preview action cannot become ready until the required SP3 is selected"
    );
});

test("the GNSS modal invalidates stale preview requests without letting them overwrite a new session", () => {
    const abort = functionSource("abortPreciseProductPreviewRequest", "function replacePendingPreciseProductSlotFile");
    const preview = functionSource("requestPreciseProductPreview", "async function importPreciseProductFiles");
    const open = functionSource("openPreciseProductImportModal", "async function requestPreciseProductPreview");
    const finalSync = preview.lastIndexOf("syncPreciseProductPreviewAction();");
    const terminalOwnership = preview.lastIndexOf("const ownsRequest");

    assert.match(abort, /preciseProductPreviewActiveRequestId\s*=\s*null/);
    assert.match(abort, /preciseProductPreviewBusy\s*=\s*false/);
    assert.match(abort, /syncPreciseProductPreviewAction\(\)/);
    assert.match(abort, /if \(hadActiveRequest\) setCatalogBusyState\(false, ""\)/);

    assert.match(open, /abortPreciseProductPreviewRequest\(\)/);
    assert.match(open, /renderPreciseProductFileList\(pendingPreciseProductFiles\)/);
    assert.match(preview, /preciseProductPreviewActiveRequestId\s*=\s*requestId/);
    assert.match(preview, /const ownsRequest\s*=\s*preciseProductPreviewActiveRequestId\s*===\s*requestId/);
    assert.match(preview, /if \(!ownsRequest\) return/);
    assert.ok(
        (preview.match(/preciseProductPreviewActiveRequestId\s*!==\s*requestId/g) || []).length >= 2,
        "both the asynchronous file read and the network response must reject stale preview sessions"
    );
    assert.ok(finalSync !== -1, "the terminal path must restore the import action");
    assert.ok(
        finalSync > terminalOwnership,
        "the active request must restore the action in its terminal path"
    );
    assert.match(
        preview,
        /openPreciseProductPreviewModal\(payload\);[\s\S]*?finally\s*\{[\s\S]*?syncPreciseProductPreviewAction\(\)/,
        "the action must reset even after a successful preview hides the file modal"
    );
    assert.match(
        sidebarSource,
        /function pendingPreciseProductHasPreviewSource\(\)\s*\{[\s\S]*?pendingPreciseProductHasSlot\("sp3"\)[\s\S]*?entry\.kind === "archive"/,
        "the established archive-only SP3 compatibility path must remain previewable"
    );
});
