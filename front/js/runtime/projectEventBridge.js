import { markOrbitRuntimeReady } from "./runtimeStatus.js";
import {
    getStartupProjectReadiness,
    publishStartupProjectActionBlocked
} from "../features/diagnostics/startupStatus.js";

const BOUND_KEY = "__orbitProjectLifecycleEventsBound";
const PENDING_COMMANDS_KEY = "__orbitPendingProjectCommands";

function dispatchCommand(windowRef, command) {
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: command }));
}

export function bindProjectLifecycleEvents({
    windowRef = window,
    projectLifecycle,
    requestDialog,
    getProjectFileHandle,
    setProjectFileHandle,
    isProjectFile,
    showAlert,
    getAlertTitle,
    logger = console
}) {
    if (windowRef[BOUND_KEY]) return;
    windowRef[BOUND_KEY] = true;

    const startupAllowsProjectAction = (action, { notify = true } = {}) => {
        if (action !== "new" && action !== "open") return true;
        const readiness = getStartupProjectReadiness(windowRef.__orbitStartupStatus);
        if (readiness.ready) return true;
        if (notify) {
            publishStartupProjectActionBlocked(action, windowRef);
            showAlert(readiness.message, getAlertTitle());
        }
        return false;
    };

    const onAction = async (event) => {
        const action = String(event.detail || "");
        if (action === "new" || action === "open") {
            if (!startupAllowsProjectAction(action)) return;
            requestDialog(action);
            return;
        }
        if (action === "export") {
            projectLifecycle.exportProject();
            return;
        }
        if (action !== "save") return;

        try {
            let fileHandle = getProjectFileHandle();
            if (!fileHandle && windowRef.showSaveFilePicker) {
                fileHandle = await windowRef.showSaveFilePicker({
                    suggestedName: "orbit-project.json",
                    types: [{ description: "Orbit project", accept: { "application/json": [".json"] } }]
                });
                setProjectFileHandle(fileHandle);
            }
            if (fileHandle) {
                await projectLifecycle.saveToHandle(fileHandle);
            } else {
                await projectLifecycle.exportProject();
            }
        } catch (error) {
            if (error?.name !== "AbortError") logger.error("Could not save project", error);
        }
    };

    const onCommand = async (event) => {
        const command = event.detail || {};
        if (command.type === "new") {
            if (!startupAllowsProjectAction("new")) return;
            try {
                projectLifecycle.startNew(command.name);
            } catch {
                showAlert("No se pudo crear el proyecto.", getAlertTitle());
            }
            return;
        }
        if (command.type === "open" && isProjectFile(command.file)) {
            if (!startupAllowsProjectAction("open")) return;
            try {
                await projectLifecycle.loadFile(command.file);
            } catch {
                showAlert("No se pudo abrir el proyecto.", getAlertTitle());
            }
        }
    };

    windowRef.addEventListener("orbit:project-action", onAction);
    windowRef.addEventListener("orbit:project-command", onCommand);

    const pendingCommands = Array.isArray(windowRef[PENDING_COMMANDS_KEY])
        ? windowRef[PENDING_COMMANDS_KEY].splice(0)
        : [];
    markOrbitRuntimeReady(windowRef);
    // Commands queued by an old/bare renderer are never replayed before the
    // backend explicitly marks its mandatory startup assets ready.
    pendingCommands
        .filter((command) => startupAllowsProjectAction(String(command?.type || ""), { notify: false }))
        .forEach((command) => dispatchCommand(windowRef, command));

    return () => {
        windowRef.removeEventListener("orbit:project-action", onAction);
        windowRef.removeEventListener("orbit:project-command", onCommand);
        delete windowRef[BOUND_KEY];
    };
}
