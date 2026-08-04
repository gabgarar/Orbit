const PENDING_COMMANDS_KEY = "__orbitPendingProjectCommands";

export const ORBIT_RUNTIME_STATUS_EVENT = "orbit:runtime-status";
export const ORBIT_RUNTIME_STATES = Object.freeze({
    LOADING: "loading",
    READY: "ready",
    FAILED: "failed"
});

function createStatus(state, error = "") {
    return Object.freeze({ state, error: String(error || "") });
}

function dispatchStatus(windowRef, status) {
    const EventConstructor = windowRef?.CustomEvent || globalThis.CustomEvent;
    if (typeof windowRef?.dispatchEvent === "function" && typeof EventConstructor === "function") {
        windowRef.dispatchEvent(new EventConstructor(ORBIT_RUNTIME_STATUS_EVENT, { detail: status }));
    }
}

export function getOrbitRuntimeStatus(windowRef = globalThis.window) {
    const stored = windowRef?.__orbitRuntimeStatus;
    if (stored && Object.values(ORBIT_RUNTIME_STATES).includes(stored.state)) return stored;
    return windowRef?.__orbitRuntimeReady === true
        ? createStatus(ORBIT_RUNTIME_STATES.READY)
        : createStatus(ORBIT_RUNTIME_STATES.LOADING);
}

export function markOrbitRuntimeReady(windowRef = globalThis.window) {
    const status = createStatus(ORBIT_RUNTIME_STATES.READY);
    windowRef.__orbitRuntimeReady = true;
    windowRef.__orbitRuntimeStatus = status;
    dispatchStatus(windowRef, status);
    return status;
}

export function markOrbitRuntimeFailed(error, windowRef = globalThis.window) {
    const current = getOrbitRuntimeStatus(windowRef);
    if (current.state === ORBIT_RUNTIME_STATES.FAILED) return current;

    const message = error instanceof Error ? error.message : String(error || "");
    const status = createStatus(ORBIT_RUNTIME_STATES.FAILED, message);
    windowRef.__orbitRuntimeReady = false;
    windowRef[PENDING_COMMANDS_KEY] = [];
    windowRef.__orbitRuntimeStatus = status;
    dispatchStatus(windowRef, status);
    return status;
}
