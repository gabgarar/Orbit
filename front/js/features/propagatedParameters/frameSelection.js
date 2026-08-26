/**
 * Transaction helpers for the ephemerides output-frame selector.
 *
 * Changing a frame is a request to the service, not a local presentation
 * toggle.  In particular, a precise SP3 may be declared in an external
 * terrestrial realization (IGS20/IGb20/IGc20) while TEME is inertial.  Keep a
 * successful inspector response intact until the service has validated the
 * complete realization + EOP/ERP route for the requested interval.
 */

function text(value) {
    return String(value ?? "").trim();
}

function frameContract(state) {
    const inspector = state?.inspector && typeof state.inspector === "object"
        ? state.inspector
        : {};
    return inspector.frame && typeof inspector.frame === "object"
        ? inspector.frame
        : {};
}

function stateFrame(state) {
    const frame = frameContract(state);
    return text(frame.current || frame.native || state?.result?.reference_frame || state?.result?.referenceFrame);
}

function nativeStateFrame(state) {
    const frame = frameContract(state);
    return text(frame.native || frame.current || state?.result?.native_reference_frame || state?.result?.reference_frame);
}

function frameLabel(value, fallback = "Nativo") {
    const normalized = text(value);
    return normalized || fallback;
}

function isExternalTerrestrialRealization(value) {
    // ITRF itself can use the ordinary Earth-orientation route. These labels
    // name external source realizations for which Orbit deliberately requires
    // a registered datum operation before it rotates into an inertial frame.
    return /^(?:IGS|IGB|IGC|WGS|PZ)/i.test(text(value));
}

function isInertial(value) {
    return /^(?:TEME|EME2000|GCRF|ICRF)$/i.test(text(value));
}

/**
 * Capture only the published top-level state.  The result and inspector are
 * immutable response snapshots in the UI, so a shallow copy is sufficient
 * and deliberately avoids copying a potentially large ephemerides array.
 */
export function createOutputFrameSelectionTransaction({
    requestedOutputFrame,
    previousRequestedOutputFrame,
    previousState
} = {}) {
    const state = previousState && typeof previousState === "object"
        ? { ...previousState }
        : null;
    return {
        requestedOutputFrame: text(requestedOutputFrame) || null,
        previousRequestedOutputFrame: text(previousRequestedOutputFrame) || null,
        previousState: state
    };
}

/**
 * Describe a failed selection without exposing a raw backend error as the
 * primary operator instruction.  The technical reason is retained after the
 * actionable explanation for diagnostics and project audit history.
 */
export function describeOutputFrameSelectionFailure({
    transaction,
    errorMessage
} = {}) {
    const priorState = transaction?.previousState || {};
    const requested = frameLabel(transaction?.requestedOutputFrame, "el marco solicitado");
    const current = stateFrame(priorState);
    const retained = transaction?.previousRequestedOutputFrame
        ? frameLabel(transaction.previousRequestedOutputFrame)
        : (current ? `Nativo (${current})` : "el último marco válido");
    const technical = text(errorMessage);
    const sourceFrame = nativeStateFrame(priorState) || current;
    const requiresTerrestrialRoute = isExternalTerrestrialRealization(sourceFrame) && isInertial(requested);
    const routeExplanation = requiresTerrestrialRoute
        ? "El SP3 está en una realización terrestre y el marco solicitado es inercial: la conversión requiere una transformación de realización terrestre registrada y cobertura ERP/EOP válida para todo el rango."
        : "La conversión requiere una ruta de marcos verificable y cobertura temporal válida para todo el rango.";
    const action = requiresTerrestrialRoute
        ? "Mantén el marco nativo o habilita la operación publicada para la realización del producto (para IGS20/IGb20/IGc20: ORBIT_TERRESTRIAL_REALIZATION=ITRF2020 y ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true) y verifica la cobertura ERP/EOP antes de reintentarlo."
        : "Mantén el marco anterior o revisa la ruta de transformación, los segundos intercalares y la cobertura ERP/EOP antes de reintentarlo.";
    return `No se pudo cambiar el marco de salida a ${requested}. Se mantiene ${retained}. ${routeExplanation} ${action}${technical ? ` Detalle técnico: ${technical}` : ""}`;
}

/**
 * Produce the exact state patch for an atomic rollback.  ``null`` means there
 * was no prior usable inspector result, so callers should use the normal
 * error path instead of pretending an old response exists.
 */
export function rollbackOutputFrameSelection(transaction, errorMessage) {
    const priorState = transaction?.previousState;
    if (!priorState || !priorState.result || !priorState.inspector) return null;
    const requestedOutputFrame = text(transaction.previousRequestedOutputFrame) || null;
    return {
        requestedOutputFrame,
        state: {
            ...priorState,
            open: true,
            status: "ready",
            requestedOutputFrame,
            // The failure is shown in a one-shot application dialog. Keeping
            // it here would turn it into a persistent inline blocker.
            error: ""
        },
        message: describeOutputFrameSelectionFailure({ transaction, errorMessage })
    };
}
