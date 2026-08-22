import assert from "node:assert/strict";
import test from "node:test";
import { bindProjectLifecycleEvents } from "../../js/runtime/projectEventBridge.js";

test("project bridge replays a project requested before Cesium finished loading", async () => {
    const windowRef = new EventTarget();
    windowRef.__orbitStartupStatus = { ready: true };
    windowRef.__orbitPendingProjectCommands = [{ type: "new", name: "Early project" }];
    const created = [];
    bindProjectLifecycleEvents({
        windowRef,
        projectLifecycle: { startNew: (name) => created.push(name), exportProject: () => {}, saveToHandle: async () => {}, loadFile: async () => {} },
        requestDialog: () => {},
        getProjectFileHandle: () => null,
        setProjectFileHandle: () => {},
        isProjectFile: () => false,
        showAlert: () => {},
        getAlertTitle: () => "Orbit",
        logger: { error: () => {} }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(windowRef.__orbitRuntimeReady, true);
    assert.equal(windowRef.__orbitRuntimeStatus.state, "ready");
    assert.deepEqual(created, ["Early project"]);
});

test("project bridge sends new and open actions to the appropriate handlers", async () => {
    const windowRef = new EventTarget();
    windowRef.__orbitStartupStatus = { ready: true };
    const dialogs = [];
    const created = [];
    const opened = [];
    bindProjectLifecycleEvents({
        windowRef,
        projectLifecycle: { startNew: (name) => created.push(name), exportProject: () => {}, saveToHandle: async () => {}, loadFile: async (file) => opened.push(file) },
        requestDialog: (mode) => dialogs.push(mode),
        getProjectFileHandle: () => null,
        setProjectFileHandle: () => {},
        isProjectFile: (file) => file?.kind === "project",
        showAlert: () => {},
        getAlertTitle: () => "Orbit",
        logger: { error: () => {} }
    });
    windowRef.dispatchEvent(new CustomEvent("orbit:project-action", { detail: "new" }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "new", name: "Mission" } }));
    const file = { kind: "project" };
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "open", file } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(dialogs, ["new"]);
    assert.deepEqual(created, ["Mission"]);
    assert.deepEqual(opened, [file]);
});

test("project bridge reports a correlated open outcome, including a cancelled replacement", async () => {
    const windowRef = new EventTarget();
    windowRef.__orbitStartupStatus = { ready: true };
    const outcomes = [];
    windowRef.addEventListener("orbit:project-command-complete", (event) => outcomes.push(event.detail));
    bindProjectLifecycleEvents({
        windowRef,
        projectLifecycle: {
            startNew: () => true,
            exportProject: () => {},
            saveToHandle: async () => {},
            loadFile: async (file) => {
                if (file?.resetFailed) {
                    const error = new Error("restoration failed after reset");
                    error.projectStateMayHaveChanged = true;
                    throw error;
                }
                return file?.cancelled !== true;
            }
        },
        requestDialog: () => {},
        getProjectFileHandle: () => null,
        setProjectFileHandle: () => {},
        isProjectFile: (file) => file?.kind === "project",
        showAlert: () => {},
        getAlertTitle: () => "Orbit",
        logger: { error: () => {} }
    });

    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", {
        detail: { type: "open", file: { kind: "project", cancelled: true }, requestId: "open-cancelled" }
    }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", {
        detail: { type: "open", file: { kind: "project" }, requestId: "open-success" }
    }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", {
        detail: { type: "open", file: { kind: "project", resetFailed: true }, requestId: "open-reset-failed" }
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(outcomes, [
        { requestId: "open-cancelled", type: "open", accepted: false, reason: "cancelled" },
        { requestId: "open-success", type: "open", accepted: true },
        { requestId: "open-reset-failed", type: "open", accepted: false, reason: "project-open-failed-after-reset" }
    ]);
});

test("project bridge rejects synthetic new/open events until the backend explicitly reports ready", async () => {
    const windowRef = new EventTarget();
    const dialogs = [];
    const created = [];
    const opened = [];
    const alerts = [];
    const blocked = [];
    windowRef.addEventListener("orbit:startup-project-action-blocked", (event) => blocked.push(event.detail));
    bindProjectLifecycleEvents({
        windowRef,
        projectLifecycle: {
            startNew: (name) => created.push(name),
            exportProject: () => {},
            saveToHandle: async () => {},
            loadFile: async (file) => opened.push(file)
        },
        requestDialog: (mode) => dialogs.push(mode),
        getProjectFileHandle: () => null,
        setProjectFileHandle: () => {},
        isProjectFile: (file) => file?.kind === "project",
        showAlert: (message) => alerts.push(message),
        getAlertTitle: () => "Orbit",
        logger: { error: () => {} }
    });
    const file = { kind: "project" };
    windowRef.dispatchEvent(new CustomEvent("orbit:project-action", { detail: "new" }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "new", name: "Blocked" } }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "open", file } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(dialogs, []);
    assert.deepEqual(created, []);
    assert.deepEqual(opened, []);
    assert.equal(alerts.length, 3);
    assert.equal(blocked.length, 3);
    assert.ok(alerts.every((message) => /preparando los datos críticos/.test(message)));
});

test("project bridge fails closed for actions and commands after logout when identity access is required", async () => {
    const windowRef = new EventTarget();
    windowRef.__orbitStartupStatus = { ready: true };
    windowRef.__orbitIdentityAccessRequired = true;
    windowRef.__orbitIdentitySession = { identityState: "local_user", accountId: "local:operator" };
    const created = [];
    const opened = [];
    const dialogs = [];
    const exports = [];
    const saves = [];
    const alerts = [];
    bindProjectLifecycleEvents({
        windowRef,
        projectLifecycle: {
            startNew: (name) => created.push(name),
            exportProject: () => exports.push("export"),
            saveToHandle: async (handle) => saves.push(handle),
            loadFile: async (file) => opened.push(file)
        },
        requestDialog: (mode) => dialogs.push(mode),
        getProjectFileHandle: () => ({ id: "existing-handle" }),
        setProjectFileHandle: () => {},
        isProjectFile: (file) => file?.kind === "project",
        showAlert: (message) => alerts.push(message),
        getAlertTitle: () => "Orbit",
        logger: { error: () => {} }
    });

    // The gate reads the current session at each event. It must not retain a
    // stale authenticated value after the user signs out.
    windowRef.__orbitIdentitySession = null;
    const file = { kind: "project" };
    windowRef.dispatchEvent(new CustomEvent("orbit:project-action", { detail: "new" }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-action", { detail: "save" }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-action", { detail: "export" }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "new", name: "Denied" } }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "open", file } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(dialogs, []);
    assert.deepEqual(created, []);
    assert.deepEqual(opened, []);
    assert.deepEqual(exports, []);
    assert.deepEqual(saves, []);
    assert.equal(alerts.length, 3, "interactive actions explain the access requirement");
    assert.ok(alerts.every((message) => /Inicia sesión/.test(message)));
});

test("project bridge accepts new and open commands for an authenticated session when the identity gate is enabled", async () => {
    const windowRef = new EventTarget();
    windowRef.__orbitStartupStatus = { ready: true };
    windowRef.__orbitIdentityAccessRequired = true;
    windowRef.__orbitIdentitySession = { identityState: "google_user", accountId: "google:operator" };
    const created = [];
    const opened = [];
    bindProjectLifecycleEvents({
        windowRef,
        projectLifecycle: {
            startNew: (name) => created.push(name),
            exportProject: () => {},
            saveToHandle: async () => {},
            loadFile: async (file) => opened.push(file)
        },
        requestDialog: () => {},
        getProjectFileHandle: () => null,
        setProjectFileHandle: () => {},
        isProjectFile: (file) => file?.kind === "project",
        showAlert: () => {},
        getAlertTitle: () => "Orbit",
        logger: { error: () => {} }
    });

    const file = { kind: "project" };
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "new", name: "Linked mission" } }));
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: { type: "open", file } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(created, ["Linked mission"]);
    assert.deepEqual(opened, [file]);
});
