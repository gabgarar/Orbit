import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker, fromIndex = 0) {
    const start = runtimeSource.indexOf(startMarker, fromIndex);
    assert.ok(start >= 0, `missing start marker: ${startMarker}`);
    const end = runtimeSource.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, `missing end marker: ${endMarker}`);
    return runtimeSource.slice(start, end);
}

test("a successful manual preview checkpoints the full physical draft only after it has rendered", () => {
    const capture = sourceBetween(
        "function captureManualOrbitPreviewCheckpoint",
        "function restoreManualOrbitPreviewCheckpoint"
    );
    assert.match(capture, /editorState:\s*manualOrbitEditorState/);
    assert.match(capture, /definitionSource:\s*manualOrbitDefinitionSource/);
    assert.match(capture, /designSettings:\s*getManualOrbitDesignSettings\(\)/);

    const preview = sourceBetween(
        "async function requestManualOrbitPreview()",
        "function scheduleManualOrbitPreview"
    );
    const renderIndex = preview.indexOf("renderManualOrbitPreview(responsePayload");
    const captureIndex = preview.indexOf("captureManualOrbitPreviewCheckpoint({ previewRendered: true })");
    assert.ok(renderIndex >= 0 && captureIndex > renderIndex,
        "only a response that actually reached Cesium may become the rollback point");

    const enter = sourceBetween("function enterManualOrbitDesignMode()", "function restoreManualOrbitDesignMode");
    assert.match(enter, /manualOrbitPreviewCheckpoint\.clear\(\);[\s\S]*captureManualOrbitPreviewCheckpoint\(\{ previewRendered: false \}\)/,
        "the initial physical draft must remain recoverable while the first preview is running");
});

test("Activity cancel restores the applied preview instead of leaving force checkboxes ahead of the canvas", () => {
    const restore = sourceBetween(
        "function restoreManualOrbitPreviewCheckpoint",
        "function stopManualOrbitPreviewRequest"
    );
    assert.match(restore, /name:\s*currentState\?\.name/,
        "metadata edits made during propagation must survive a physics rollback");
    assert.match(restore, /objectMetadata:\s*currentState\?\.objectMetadata/);
    assert.match(restore, /publishManualOrbitState\(\{[\s\S]*previewRestored:\s*true/,
        "the controlled React form must receive the restored physics state");

    const bridgeStart = runtimeSource.indexOf("function setupManualOrbitEditorBridge()");
    assert.ok(bridgeStart >= 0, "manual-orbit bridge must exist");
    const cancellationStart = runtimeSource.indexOf('window.addEventListener("orbit:operation-cancel-request"', bridgeStart);
    const cancellationEnd = runtimeSource.indexOf('window.addEventListener("orbit:manual-orbit-change"', cancellationStart);
    assert.ok(cancellationStart >= bridgeStart && cancellationEnd > cancellationStart,
        "manual preview cancellation must be handled by the manual-orbit bridge");
    const cancellation = runtimeSource.slice(cancellationStart, cancellationEnd);
    const previewBranchStart = cancellation.indexOf("if (requestedId === manualOrbitPreviewOperationId)");
    const createBranchStart = cancellation.indexOf("if (requestedId === manualOrbitCreateOperationId)", previewBranchStart);
    assert.ok(previewBranchStart >= 0 && createBranchStart > previewBranchStart);
    const previewBranch = cancellation.slice(previewBranchStart, createBranchStart);
    const restoreIndex = previewBranch.indexOf("restoreManualOrbitPreviewCheckpoint()");
    assert.ok(restoreIndex > previewBranch.indexOf("stopManualOrbitPreviewRequest()"),
        "the current request must first be aborted/invalidated, then rolled back");
    assert.doesNotMatch(previewBranch.slice(0, restoreIndex), /clearManualOrbitPreview\(\)/,
        "a previously valid trajectory must remain visible while the form rolls back");
    assert.match(previewBranch, /if \(!rollback\.previewRendered\)[\s\S]*scheduleManualOrbitPreview\(\{ immediate: true \}\)/,
        "cancelling the first calculation must recover a valid baseline preview");
});

test("ordinary rapid edits supersede only the request and do not unexpectedly roll back the newer draft", () => {
    const schedule = sourceBetween(
        "function scheduleManualOrbitPreview",
        "function isExpectedManualOrbitRequestCancellation"
    );
    assert.match(schedule, /stopManualOrbitPreviewRequest\(\)/);
    assert.doesNotMatch(schedule, /restoreManualOrbitPreviewCheckpoint\(\)/,
        "rollback is reserved for the explicit Activity-panel cancellation action");
});
