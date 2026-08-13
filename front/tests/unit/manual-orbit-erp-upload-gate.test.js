import assert from "node:assert/strict";
import test from "node:test";

import { createManualErpUploadGate } from "../../js/features/manualOrbit/erpUploadGate.js";

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
