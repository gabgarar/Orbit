import { markOrbitRuntimeReady } from "./runtimeStatus.js";
import {
    getStartupProjectReadiness,
    publishStartupProjectActionBlocked
} from "../features/diagnostics/startupStatus.js";
import { isAuthenticatedIdentityState } from "../features/identity/index.js";

const BOUND_KEY = "__orbitProjectLifecycleEventsBound";
const PENDING_COMMANDS_KEY = "__orbitPendingProjectCommands";

function dispatchCommand(windowRef, command) {
    windowRef.dispatchEvent(new CustomEvent("orbit:project-command", { detail: command }));
}

// A command can be accepted by the runtime bridge but later be cancelled by
// the user (for example, replacing an open project).  This narrow completion
// event deliberately carries no file or project document, only the caller's
// opaque request id and outcome, so the React library can keep its active
// encrypted record aligned with the actual renderer state.
function dispatchCommandCompletion(windowRef, command, { accepted, reason = null } = {}) {
    const requestId = String(command?.requestId || "").trim();
    if (!requestId) return;
    const EventConstructor = windowRef.CustomEvent || globalThis.CustomEvent;
    if (typeof EventConstructor !== "function") return;
    windowRef.dispatchEvent(new EventConstructor("orbit:project-command-complete", {
        detail: {
            requestId,
            type: String(command?.type || "").trim().toLowerCase(),
            accepted: accepted === true,
            ...(reason ? { reason: String(reason) } : {})
        }
    }));
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

    const identityAllowsProjectAction = () => {
        if (windowRef.__orbitIdentityAccessRequired !== true) return true;
        return isAuthenticatedIdentityState(windowRef.__orbitIdentitySession?.identityState);
    };

    const onAction = async (event) => {
        const action = String(event.detail || "");
        if (!identityAllowsProjectAction()) {
            if (action === "new" || action === "open" || action === "save" || action === "export") {
                showAlert("Inicia sesión para acceder a los proyectos.", getAlertTitle());
            }
            return;
        }
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
        if (!identityAllowsProjectAction()) {
            dispatchCommandCompletion(windowRef, command, { accepted: false, reason: "identity-required" });
            return;
        }
        if (command.type === "new") {
            if (!startupAllowsProjectAction("new")) {
                dispatchCommandCompletion(windowRef, command, { accepted: false, reason: "startup-not-ready" });
                return;
            }
            try {
                const created = projectLifecycle.startNew(command.name);
                dispatchCommandCompletion(windowRef, command, {
                    accepted: created !== false,
                    reason: created === false ? "cancelled" : null
                });
            } catch {
                showAlert("No se pudo crear el proyecto.", getAlertTitle());
                dispatchCommandCompletion(windowRef, command, { accepted: false, reason: "project-create-failed" });
            }
            return;
        }
        if (command.type !== "open") return;
        if (!isProjectFile(command.file)) {
            dispatchCommandCompletion(windowRef, command, { accepted: false, reason: "invalid-project-file" });
            return;
        }
        if (!startupAllowsProjectAction("open")) {
            dispatchCommandCompletion(windowRef, command, { accepted: false, reason: "startup-not-ready" });
            return;
        }
        try {
            const opened = await projectLifecycle.loadFile(command.file);
            dispatchCommandCompletion(windowRef, command, {
                accepted: opened !== false,
                reason: opened === false ? "cancelled" : null
            });
        } catch (error) {
            showAlert("No se pudo abrir el proyecto.", getAlertTitle());
            dispatchCommandCompletion(windowRef, command, {
                accepted: false,
                reason: error?.projectStateMayHaveChanged === true
                    ? "project-open-failed-after-reset"
                    : "project-open-failed"
            });
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
