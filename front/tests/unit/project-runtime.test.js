import assert from "node:assert/strict";
import test from "node:test";
import {
    getOrbitRuntimeStatus,
    markOrbitRuntimeFailed,
    requestProjectCommand
} from "../../../react-ui/src/services/projectRuntime.js";

test("project commands fail closed until startup explicitly reports ready", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    globalThis.window = events;
    try {
        assert.deepEqual(requestProjectCommand({ type: "new", name: "Blocked project" }), {
            accepted: false,
            reason: "Orbit está preparando los datos críticos (ERP y modelos de gravedad). Espera a que finalice la descarga y validación antes de crear o importar un proyecto.",
            code: "startup-not-ready"
        });
        assert.equal(events.__orbitPendingProjectCommands, undefined);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("identity gate rejects create and open requests before they can reach the project runtime", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    events.__orbitIdentityAccessRequired = true;
    events.__orbitStartupStatus = { ready: true };
    events.__orbitRuntimeReady = true;
    globalThis.window = events;
    try {
        let dispatches = 0;
        events.addEventListener("orbit:project-command", () => { dispatches += 1; });

        for (const command of [
            { type: "new", name: "Protected mission" },
            { type: "open", file: { name: "protected.orbit" } }
        ]) {
            assert.deepEqual(requestProjectCommand(command), {
                accepted: false,
                reason: "Inicia sesión para crear, abrir o gestionar proyectos.",
                code: "identity-required"
            });
        }
        assert.equal(dispatches, 0);
        assert.equal(events.__orbitPendingProjectCommands, undefined);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("an authenticated identity can issue project commands through the required access gate", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    events.__orbitIdentityAccessRequired = true;
    events.__orbitIdentitySession = { identityState: "local_user", accountId: "local:operator" };
    events.__orbitStartupStatus = { ready: true };
    events.__orbitRuntimeReady = true;
    globalThis.window = events;
    try {
        let command = null;
        events.addEventListener("orbit:project-command", (event) => { command = event.detail; });

        assert.deepEqual(requestProjectCommand({ type: "new", name: "Authenticated mission" }), {
            accepted: true,
            queued: false
        });
        assert.deepEqual(command, { type: "new", name: "Authenticated mission" });
    } finally {
        globalThis.window = previousWindow;
    }
});

test("project commands queue only after startup explicitly reports ready", () => {
    const previousWindow = globalThis.window;
    const events = new EventTarget();
    events.__orbitStartupStatus = { ready: true };
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
    events.__orbitStartupStatus = { ready: true };
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
