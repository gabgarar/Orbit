import assert from "node:assert/strict";
import test from "node:test";

import {
    __resetOperationStoreForTests,
    bindOperationEvents,
    cancelOperation,
    clearOperationsForScope,
    completeOperation,
    getActiveOperations,
    ORBIT_OPERATION_CANCEL_REQUEST_EVENT,
    ORBIT_OPERATION_START_EVENT,
    ORBIT_OPERATION_UPDATE_EVENT,
    ORBIT_OPERATIONS_STATE_EVENT,
    requestOperationCancel,
    startOperation,
    subscribeToOperations,
    updateOperation
} from "../../js/features/operations/operationsContract.js";

function reset() {
    __resetOperationStoreForTests();
}

test("operation lifecycle exposes only live work and retains exact zero progress", () => {
    reset();
    const target = new EventTarget();
    const states = [];
    const unbind = bindOperationEvents(target);
    const unsubscribe = subscribeToOperations((operations) => states.push(operations));

    startOperation({
        id: "sp3-import",
        title: "Importando SP3",
        scope: "scene",
        stage: "Leyendo cabecera",
        progress: 0,
        cancellable: true
    }, target);
    updateOperation({ id: "sp3-import", stage: "Interpolando estados", progress: 42, message: "12.000 épocas" }, target);

    assert.deepEqual(getActiveOperations(), [{
        id: "sp3-import",
        title: "Importando SP3",
        scope: "scene",
        status: "running",
        stage: "Interpolando estados",
        progress: 42,
        message: "12.000 épocas",
        cancellable: true,
        startedAt: getActiveOperations()[0].startedAt,
        updatedAt: getActiveOperations()[0].updatedAt
    }]);
    assert.equal(target.__orbitActiveOperations[0].progress, 42);
    assert.equal(states.at(-1)[0].title, "Importando SP3");

    completeOperation({ id: "sp3-import" }, target);
    assert.deepEqual(getActiveOperations(), []);
    assert.deepEqual(states.at(-1), []);
    unsubscribe();
    unbind();
});

test("legacy DOM events feed the same ledger and a scope clear cannot affect other work", () => {
    reset();
    const target = new EventTarget();
    const unbind = bindOperationEvents(target);
    const published = [];
    target.addEventListener(ORBIT_OPERATIONS_STATE_EVENT, (event) => published.push(event.detail));

    target.dispatchEvent(new CustomEvent(ORBIT_OPERATION_START_EVENT, { detail: {
        id: "orbit-preview", title: "Previsualizando órbita", scope: "manual-orbit", status: "queued"
    } }));
    target.dispatchEvent(new CustomEvent(ORBIT_OPERATION_START_EVENT, { detail: {
        id: "project-save", title: "Guardando proyecto", scope: "project"
    } }));
    target.dispatchEvent(new CustomEvent(ORBIT_OPERATION_UPDATE_EVENT, { detail: {
        id: "orbit-preview", progress: 0, stage: "Preparando propagador"
    } }));

    assert.equal(getActiveOperations().find((item) => item.id === "orbit-preview")?.status, "queued");
    assert.equal(getActiveOperations().find((item) => item.id === "orbit-preview")?.progress, 0);
    clearOperationsForScope("manual-orbit", target);
    assert.deepEqual(getActiveOperations().map((item) => item.id), ["project-save"]);
    assert.ok(published.length >= 4);
    unbind();
});

test("late callbacks and repeated cancellation are harmless, while cancellation is requested from the owner", () => {
    reset();
    const target = new EventTarget();
    const unbind = bindOperationEvents(target);
    const requests = [];
    target.addEventListener(ORBIT_OPERATION_CANCEL_REQUEST_EVENT, (event) => requests.push(event.detail));

    updateOperation({ id: "never-started", progress: 50 }, target);
    assert.deepEqual(getActiveOperations(), []);
    startOperation({ id: "propagation", title: "Propagando", scope: "scene", cancellable: true }, target);
    assert.equal(requestOperationCancel({ id: "propagation", scope: "scene" }, target), true);
    assert.deepEqual(requests, [{ id: "propagation", scope: "scene" }]);
    cancelOperation({ id: "propagation" }, target);
    cancelOperation({ id: "propagation" }, target);
    assert.deepEqual(getActiveOperations(), []);
    unbind();
});
