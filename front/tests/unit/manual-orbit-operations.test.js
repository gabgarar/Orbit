import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/ManualOrbitPanel.jsx", import.meta.url),
    "utf8"
);

test("manual preview preserves the full planner request and publishes its activity", () => {
    assert.doesNotMatch(runtimeSource, /manualOrbitPreviewWindow|previewSampling/);
    assert.doesNotMatch(runtimeSource, /buildManualOrbitRequestPayload\(windowRange, \{ preview: true \}\)/);
    assert.match(
        runtimeSource,
        /body: JSON\.stringify\(buildManualOrbitRequestPayload\(windowRange\)\),[\s\S]*signal: controller\.signal/,
        "preview must use the exact normal planner payload and remain cancellable"
    );
    assert.match(runtimeSource, /startManualOrbitOperation\("preview", requestId/);
    assert.match(
        runtimeSource,
        /completeManualOrbitOperation\([\s\S]*?actualEarthOrientation[\s\S]*?Previsualizaci(?:\\u00f3|ó)n actualizada/,
        "the completed activity must retain the actual EOP provenance when the backend returned it"
    );
    assert.doesNotMatch(panelSource, /manual-orbit-cowell-preview-policy/);
});

test("manual create/upload work is scoped, cancellable, and cannot clear scene work", () => {
    assert.match(runtimeSource, /scope: MANUAL_ORBIT_OPERATION_SCOPE/);
    assert.match(runtimeSource, /startManualOrbitOperation\("create", createRequestId/);
    assert.match(runtimeSource, /startManualOrbitOperation\("erp", \+\+manualOrbitErpUploadOperationSequence/);
    assert.match(runtimeSource, /window\.addEventListener\("orbit:operation-cancel-request"/);
    assert.match(runtimeSource, /stopManualOrbitCreateRequest\(\);[\s\S]*publishManualOrbitStatus\("info", "Creaci\\u00f3n de \\u00f3rbita cancelada\."\)/);
    assert.match(runtimeSource, /clearOperationsForScope\(MANUAL_ORBIT_OPERATION_SCOPE\)/);
    assert.doesNotMatch(runtimeSource, /clearOperationsForScope\("scene"\)/);
});

test("legacy upstream abort text is made actionable without asking Orbit to truncate the design", () => {
    assert.match(runtimeSource, /operation was aborted[\s\S]*Consulta el estado de operaciones/);
    assert.doesNotMatch(runtimeSource, /operation was aborted[\s\S]*reduce la ventana de dise/i);
});

test("cancelling an active preview restores its last applied controls and trajectory checkpoint", () => {
    assert.match(runtimeSource, /createManualOrbitPreviewCheckpoint/);
    assert.match(
        runtimeSource,
        /renderManualOrbitPreview\(responsePayload,[\s\S]*?captureManualOrbitPreviewCheckpoint\(\{ previewRendered: true \}\)/,
        "only a response that was rendered may become the rollback checkpoint"
    );
    assert.match(
        runtimeSource,
        /requestedId === manualOrbitPreviewOperationId[\s\S]*?stopManualOrbitPreviewRequest\(\);[\s\S]*?restoreManualOrbitPreviewCheckpoint\(\)/,
        "the Activity cancel action must restore instead of leaving the optimistic draft active"
    );
    assert.match(runtimeSource, /previewRestored: true/);
    const cancellationBranch = runtimeSource.slice(
        runtimeSource.indexOf("if (requestedId === manualOrbitPreviewOperationId)"),
        runtimeSource.indexOf("if (requestedId === manualOrbitCreateOperationId)")
    );
    assert.doesNotMatch(
        cancellationBranch,
        /stopManualOrbitPreviewRequest\(\);\s*clearManualOrbitPreview\(\);/,
        "a valid prior design preview must remain visible during rollback"
    );
});
