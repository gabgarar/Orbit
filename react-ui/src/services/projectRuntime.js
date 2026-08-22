import {
    getOrbitRuntimeStatus,
    markOrbitRuntimeFailed,
    ORBIT_RUNTIME_STATUS_EVENT,
    ORBIT_RUNTIME_STATES
} from "../../../front/js/runtime/runtimeStatus.js";
import {
    getStartupProjectReadiness,
    publishStartupProjectActionBlocked
} from "../../../front/js/features/diagnostics/startupStatus.js";
import { isAuthenticatedIdentityState } from "../../../front/js/features/identity/index.js";

const PENDING_COMMANDS_KEY = "__orbitPendingProjectCommands";

export { getOrbitRuntimeStatus, markOrbitRuntimeFailed, ORBIT_RUNTIME_STATUS_EVENT };

function dispatchCommand(windowRef, command) {
    const EventConstructor = windowRef.CustomEvent || globalThis.CustomEvent;
    windowRef.dispatchEvent(new EventConstructor("orbit:project-command", { detail: command }));
}

export function requestProjectCommand(command, windowRef = globalThis.window) {
    // `__orbitIdentityAccessRequired` is installed by the React entry point.
    // Keeping this opt-in global preserves the isolated legacy/runtime unit
    // harnesses while making the production command bridge fail closed before
    // React's access panel has authenticated a user.
    if (windowRef?.__orbitIdentityAccessRequired === true
        && !isAuthenticatedIdentityState(windowRef.__orbitIdentitySession?.identityState)) {
        return {
            accepted: false,
            reason: "Inicia sesión para crear, abrir o gestionar proyectos.",
            code: "identity-required"
        };
    }
    const runtimeStatus = getOrbitRuntimeStatus(windowRef);
    if (runtimeStatus.state === ORBIT_RUNTIME_STATES.FAILED) {
        return { accepted: false, reason: runtimeStatus.error };
    }
    const action = String(command?.type || "").trim().toLowerCase();
    if (action === "new" || action === "open") {
        const readiness = getStartupProjectReadiness(windowRef?.__orbitStartupStatus);
        if (!readiness.ready) {
            publishStartupProjectActionBlocked(action, windowRef);
            return { accepted: false, reason: readiness.message, code: "startup-not-ready" };
        }
    }
    if (runtimeStatus.state === ORBIT_RUNTIME_STATES.READY) {
        dispatchCommand(windowRef, command);
        return { accepted: true, queued: false };
    }

    const pending = Array.isArray(windowRef[PENDING_COMMANDS_KEY]) ? windowRef[PENDING_COMMANDS_KEY] : [];
    pending.push(command);
    windowRef[PENDING_COMMANDS_KEY] = pending;
    return { accepted: true, queued: true };
}
