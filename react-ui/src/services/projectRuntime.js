import {
    getOrbitRuntimeStatus,
    markOrbitRuntimeFailed,
    ORBIT_RUNTIME_STATUS_EVENT,
    ORBIT_RUNTIME_STATES
} from "../../../front/js/runtime/runtimeStatus.js";

const PENDING_COMMANDS_KEY = "__orbitPendingProjectCommands";

export { getOrbitRuntimeStatus, markOrbitRuntimeFailed, ORBIT_RUNTIME_STATUS_EVENT };

function dispatchCommand(windowRef, command) {
    const EventConstructor = windowRef.CustomEvent || globalThis.CustomEvent;
    windowRef.dispatchEvent(new EventConstructor("orbit:project-command", { detail: command }));
}

export function requestProjectCommand(command, windowRef = globalThis.window) {
    const runtimeStatus = getOrbitRuntimeStatus(windowRef);
    if (runtimeStatus.state === ORBIT_RUNTIME_STATES.FAILED) {
        return { accepted: false, reason: runtimeStatus.error };
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
