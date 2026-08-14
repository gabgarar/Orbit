import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    createDefaultManualOrbitState,
    synchronizeManualOrbitState
} from "../../js/features/manualOrbit/editorState.js";
import { createManualErpUploadGate } from "../../js/features/manualOrbit/erpUploadGate.js";
import { physicalEpochAtDesignWindowStart } from "../../js/features/manualOrbit/timePolicy.js";

const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../../../react-ui/src/components/ManualOrbitPanel.jsx", import.meta.url), "utf8");

class FakeAbortController {
    constructor() {
        this.signal = { aborted: false };
        this.abortCalls = 0;
    }

    abort() {
        this.abortCalls += 1;
        this.signal.aborted = true;
    }
}

test("manual ERP upload ignores a late result after Clear", () => {
    const gate = createManualErpUploadGate({ AbortControllerImpl: FakeAbortController });
    const upload = gate.begin();

    gate.cancel(); // TIME: Quitar

    assert.equal(upload.controller.signal.aborted, true);
    assert.equal(upload.controller.abortCalls, 1);
    assert.equal(upload.isCurrent(), false);
});

test("manual ERP upload replacement makes only the latest response eligible", () => {
    const gate = createManualErpUploadGate({ AbortControllerImpl: FakeAbortController });
    const first = gate.begin();
    const replacement = gate.begin(); // TIME: Reemplazar

    assert.equal(first.controller.signal.aborted, true);
    assert.equal(first.isCurrent(), false);
    assert.equal(replacement.isCurrent(), true);

    replacement.finish();
    assert.equal(replacement.isCurrent(), false);
});

test("validated ERP preflight anchors the canonical physical epoch and publishes it to TIME", () => {
    const suggestedWindow = {
        startTime: "2026-05-10T00:00:00Z",
        endTime: "2026-05-13T00:00:00Z"
    };
    const epochUtc = physicalEpochAtDesignWindowStart(suggestedWindow);
    const stale = createDefaultManualOrbitState({ now: "2026-08-13T21:16:00Z" });
    const anchored = synchronizeManualOrbitState(stale, { epochUtc }, undefined);

    assert.equal(anchored.epochUtc, "2026-05-10T00:00:00.000Z");
    assert.deepEqual(anchored.stateVector, stale.stateVector);
    assert.match(mainSource, /const anchoredPhysicalEpoch = anchorManualOrbitPhysicalEpochToDesignStart\(suggestedWindow\)/);
    assert.match(mainSource, /epochUtc: anchoredPhysicalEpoch,[\s\S]*?epochStartUtc: suggestedWindow\.startTime/);
    assert.match(mainSource, /physicalEpochUtc: anchoredPhysicalEpoch/);
    assert.match(panelSource, /anchorPhysicalEpoch: true/);
    assert.match(panelSource, /physicalEpochAtDesignWindowStart\(suggestedWindow\)/);
});

test("manual geopotential actions are guarded by the full propagation block, not only disabled DOM controls", () => {
    assert.match(panelSource, /if \(propagationBlockMessage\) \{/);
    assert.match(panelSource, /disabled=\{!epochRangeValid \|\| !timePolicy\.canCreate \|\| !canRunSelectedPropagation/);
    assert.match(panelSource, /selectedGeopotentialSelectionExecutable/);
    assert.match(panelSource, /La solicitud N=\{selectedGeopotentialDegree\}, M=\{selectedGeopotentialOrder\} se conserva sin cambios/);
    assert.match(mainSource, /manualOrbitGeopotentialAdjustmentMessage/);
    assert.match(mainSource, /Geopotencial ajustado de \$\{requestedDegree\}×\$\{requestedOrder\} a \$\{effectiveDegree\}×\$\{effectiveOrder\}/);
});
