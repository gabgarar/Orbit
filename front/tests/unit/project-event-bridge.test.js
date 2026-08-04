import assert from "node:assert/strict";
import test from "node:test";
import { bindProjectLifecycleEvents } from "../../js/runtime/projectEventBridge.js";

test("project bridge replays a project requested before Cesium finished loading", async () => {
    const windowRef = new EventTarget();
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
