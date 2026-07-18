import assert from "node:assert/strict";
import test from "node:test";
import {
    getOrbitRuntimeStatus,
    markOrbitRuntimeFailed,
    requestProjectCommand
} from "../../../react-ui/src/services/projectRuntime.js";

test("project commands queue until the Cesium runtime is ready", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    globalThis.window = events;
    try {
        requestProjectCommand({ type: "new", name: "Queued project" });
        assert.deepEqual(events.__orbitPendingProjectCommands, [{ type: "new", name: "Queued project" }]);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("project commands dispatch immediately once the runtime is ready", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    events.__orbitRuntimeReady = true;
    globalThis.window = events;
    try {
        let command = null;
        events.addEventListener("orbit:project-command", (event) => { command = event.detail; });
        requestProjectCommand({ type: "new", name: "Immediate project" });
        assert.deepEqual(command, { type: "new", name: "Immediate project" });
    } finally {
        globalThis.window = previousWindow;
    }
});

test("a failed runtime clears queued commands and rejects new project requests", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    events.__orbitPendingProjectCommands = [{ type: "new", name: "Stale project" }];
    globalThis.window = events;
    try {
        let status;
        events.addEventListener("orbit:runtime-status", (event) => { status = event.detail; });
        markOrbitRuntimeFailed(new Error("legacy chunk unavailable"));

        assert.deepEqual(events.__orbitPendingProjectCommands, []);
        assert.equal(status.state, "failed");
        assert.equal(getOrbitRuntimeStatus().error, "legacy chunk unavailable");
        assert.deepEqual(requestProjectCommand({ type: "new", name: "Rejected project" }), {
            accepted: false,
            reason: "legacy chunk unavailable"
        });
        assert.deepEqual(events.__orbitPendingProjectCommands, []);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("a fatal failure after ready replaces the runtime status", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    events.__orbitRuntimeReady = true;
    globalThis.window = events;
    try {
        const status = markOrbitRuntimeFailed(new Error("sidebar bootstrap failed"));

        assert.equal(status.state, "failed");
        assert.equal(status.error, "sidebar bootstrap failed");
        assert.equal(events.__orbitRuntimeReady, false);
        assert.equal(getOrbitRuntimeStatus().state, "failed");
    } finally {
        globalThis.window = previousWindow;
    }
});
