import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const lifecycleSource = readFileSync(new URL("../../js/runtime/projectLifecycle.js", import.meta.url), "utf8");
const documentSource = readFileSync(new URL("../../js/runtime/projectDocument.js", import.meta.url), "utf8");

test("propagated-parameters history is project-bound, snapshot-persisted and distinct from the live operation ledger", () => {
    assert.match(runtimeSource, /let propagatedParametersHistory = \[\];/);
    assert.match(runtimeSource, /function startPropagatedParametersHistory\(/);
    assert.match(runtimeSource, /function updatePropagatedParametersHistory\(/);
    assert.match(runtimeSource, /publishAuthenticatedProjectDocumentSnapshot\("propagation-history"\)/);
    assert.match(runtimeSource, /status: "completed"/);
    assert.match(runtimeSource, /status: "failed"/);
    assert.match(runtimeSource, /status: "cancelled"/);
    assert.match(runtimeSource, /getPropagationHistory: getPropagatedParametersHistoryForProject/);
    assert.match(runtimeSource, /restorePropagationHistory: restorePropagatedParametersHistoryForProject/);
});

test("portable project lifecycle serializes and restores only propagation audit metadata", () => {
    assert.match(documentSource, /normalizeProjectPropagationHistory/);
    assert.match(documentSource, /propagationHistory: normalizeProjectPropagationHistory\(propagationHistory\)/);
    assert.match(lifecycleSource, /propagationHistory: getPropagationHistory\(\)/);
    assert.match(lifecycleSource, /clearPropagationHistory\(\);/);
    assert.match(lifecycleSource, /await restorePropagationHistory\(propagationHistory\);/);
});
