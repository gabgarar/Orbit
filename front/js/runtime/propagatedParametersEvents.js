export const PROPAGATED_PARAMETERS_OPEN_EVENT = "orbit:propagated-parameters-open";
export const PROPAGATED_PARAMETERS_CLOSE_EVENT = "orbit:propagated-parameters-close";
export const PROPAGATED_PARAMETERS_CONTEXT_EVENT = "orbit:propagated-parameters-context";

function dispatch(eventName, detail) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent === "undefined") {
        return;
    }
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function emitPropagatedParametersOpen(detail = {}) {
    dispatch(PROPAGATED_PARAMETERS_OPEN_EVENT, detail);
}

export function emitPropagatedParametersClose(detail = {}) {
    dispatch(PROPAGATED_PARAMETERS_CLOSE_EVENT, detail);
}

export function emitPropagatedParametersContext(detail = {}) {
    dispatch(PROPAGATED_PARAMETERS_CONTEXT_EVENT, detail);
}
